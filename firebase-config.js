(function () {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyBorlkbEGYsZYaFW1kPQnBunF5Rmo7rICU',
    authDomain: 'chto-zadali.firebaseapp.com',
    databaseURL: 'https://chto-zadali-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'chto-zadali',
    storageBucket: 'chto-zadali.firebasestorage.app',
    messagingSenderId: '98830843826',
    appId: '1:98830843826:web:826f959c8003c734e56eab'
  };

  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
  const database = app.database();
  const studentsRef = database.ref('students');
  const STORAGE_KEY = 'chtoZadaliDataV1';
  const TASK_TYPE_IMAGES = {
    make: 'assets/student-ui/task-types/task-do.png',
    online: 'assets/student-ui/task-types/task-online.png',
    media: 'assets/student-ui/task-types/task-watch-listen.png',
    learn: 'assets/student-ui/task-types/task-learn-repeat.png',
    read: 'assets/student-ui/task-types/task-read.png',
    other: 'assets/student-ui/task-types/task-other.png'
  };

  function taskTypeKey(value) {
    const source = String(value || '').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');
    const compact = source.replace(/[\s_\-/]+/g, '');
    if (compact === 'make' || compact === 'do' || source.includes('сделать')) return 'make';
    if (compact === 'online' || source.includes('онлайн')) return 'online';
    if (['media', 'watch', 'listen', 'watchlisten', 'video'].includes(compact) || /видео|посмотр|послуш/.test(source)) return 'media';
    if (['learn', 'repeat', 'learnrepeat'].includes(compact) || /выуч|повтор/.test(source)) return 'learn';
    if (compact === 'read' || source.includes('прочит')) return 'read';
    return 'other';
  }

  function taskTypeImage(value) {
    return TASK_TYPE_IMAGES[taskTypeKey(value)] || TASK_TYPE_IMAGES.other;
  }

  function normalizeTasks(tasks) {
    const values = Array.isArray(tasks) ? tasks : Object.values(tasks || {});
    return values.filter(Boolean).map((task) => ({
      id: String(task.id),
      type: task.type || 'other',
      title: task.title || '',
      description: task.description || '',
      url: task.url || task.link || '',
      completed: Boolean(task.completed),
      submissionImage: typeof task.submissionImage === 'string' ? task.submissionImage : '',
      submissionUpdatedAt: task.submissionUpdatedAt || '',
      requiresSubmission: Boolean(task.requiresSubmission || task.requiresFile),
      fileName: task.fileName || task.attachmentName || task.attachment?.name || '',
      fileUrl: task.fileUrl || task.attachmentUrl || task.fileData || task.attachment?.url || task.attachment?.data || ''
    }));
  }

  function tasksToRecord(tasks) {
    return normalizeTasks(tasks).reduce((result, task) => {
      result[task.id] = task;
      return result;
    }, {});
  }

  function localStudents() {
    let oldData;
    try { oldData = JSON.parse(localStorage.getItem(STORAGE_KEY)); }
    catch (error) { console.warn('Не удалось прочитать данные для миграции:', error); }
    if (!oldData || !Array.isArray(oldData.students) || !oldData.students.length) return null;

    const result = {};
    oldData.students.forEach((student) => {
      if (!student || !student.id) return;
      const id = String(student.id);
      const draft = oldData.drafts?.[id] || {};
      const published = oldData.published?.[id] || null;
      result[id] = {
        id,
        name: student.name || 'Ученик',
        draft: {
          lessonDate: draft.lessonDate || '',
          lessonTime: draft.lessonTime || '',
          tasks: normalizeTasks(draft.tasks)
        },
        completed: oldData.completed?.[id] || {}
      };
      if (published) result[id].published = {
        lessonDate: published.lessonDate || '',
        lessonTime: published.lessonTime || '',
        tasks: normalizeTasks(published.tasks),
        publishedAt: published.publishedAt || new Date().toISOString()
      };
    });
    return result;
  }

  async function migrateLocalDataOnce() {
    const migration = localStudents();
    if (!migration) return false;
    const result = await studentsRef.transaction((current) => {
      if (current && Object.keys(current).length) return;
      return migration;
    });
    if (result.committed) localStorage.setItem('chtoZadaliFirebaseMigratedV1', 'true');
    return result.committed;
  }

  async function migrateHomeworkStructureOnce() {
    return studentsRef.transaction((current) => {
      if (!current) return current;
      let changed = false;
      Object.keys(current).forEach((studentId) => {
        const student = current[studentId];
        if (!student || Number(student.migrationVersion) >= 3) return;

        // Version 2 could create an empty legacy-draft from the old empty
        // draft placeholder. It is safe to remove only that deterministic
        // migration ID; user-created drafts have their own UUIDs.
        const legacyDraft = student.homeworks?.['legacy-draft'];
        if (legacyDraft && legacyDraft.status === 'draft' && !legacyDraft.dueDate && !legacyDraft.dueTime && normalizeTasks(legacyDraft.tasks).length === 0) {
          delete student.homeworks['legacy-draft'];
          if (Object.keys(student.homeworks).length === 0) delete student.homeworks;
          changed = true;
        }

        if (Number(student.migrationVersion) >= 2) {
          student.migrationVersion = 3;
          changed = true;
          return;
        }

        // A non-empty homeworks node means this student was migrated by an
        // earlier app version. Mark it now, but never rebuild or replace it.
        if (student.homeworks && Object.keys(student.homeworks).length) {
          student.migrationVersion = 3;
          changed = true;
          return;
        }

        const homeworks = {};
        const completed = student.completed || {};
        const makeHomework = (id, source, status) => {
          if (!source) return;
          const tasks = normalizeTasks(source.tasks).map(task => ({ ...task, completed: Boolean(completed[task.id]) }));
          homeworks[id] = { id, dueDate: source.lessonDate || '', dueTime: source.lessonTime || '', status, tasks: tasksToRecord(tasks) };
        };
        if (student.published) makeHomework('legacy-published', student.published, 'published');
        const draftHasContent = student.draft && (student.draft.lessonDate || student.draft.lessonTime || normalizeTasks(student.draft.tasks).length > 0);
        if (draftHasContent) {
          const publishedJson = JSON.stringify(normalizeTasks(student.published?.tasks));
          const draftJson = JSON.stringify(normalizeTasks(student.draft.tasks));
          if (!student.published || publishedJson !== draftJson || student.published.lessonDate !== student.draft.lessonDate || student.published.lessonTime !== student.draft.lessonTime) {
            makeHomework('legacy-draft', student.draft, 'draft');
          }
        }
        if (Object.keys(homeworks).length) {
          student.homeworks = homeworks;
        }
        // The marker is written in the same transaction as the copied data.
        // Even an empty result is final: deleted homeworks must stay deleted.
        student.migrationVersion = 3;
        changed = true;
      });
      return changed ? current : undefined;
    });
  }

  function grantCompletedHomeworkCoins(studentId) {
    if (!studentId) return Promise.resolve(null);
    return database.ref(`students/${studentId}`).transaction((student) => {
      if (!student) return student;
      let earned = 0;
      Object.values(student.homeworks || {}).forEach((homework) => {
        if (!homework || homework.status !== 'published' || homework.coinGranted === true) return;
        const homeworkTasks = normalizeTasks(homework.tasks);
        if (homeworkTasks.length && homeworkTasks.every(task => task.completed)) {
          homework.coinGranted = true;
          earned += 1;
        }
      });
      if (!earned) return;
      student.pet = student.pet || {};
      student.pet.coinsBalance = (Number(student.pet.coinsBalance) || 0) + earned;
      return student;
    });
  }

  function toggleTaskCompletionAndGrant(studentId, homeworkId, taskId) {
    return database.ref(`students/${studentId}`).transaction((student) => {
      const homework = student?.homeworks?.[homeworkId];
      const task = homework?.tasks?.[taskId];
      if (!task) return;
      task.completed = !Boolean(task.completed);
      const homeworkTasks = normalizeTasks(homework.tasks);
      if (homework.status === 'published' && homework.coinGranted !== true && homeworkTasks.length && homeworkTasks.every(item => item.completed)) {
        homework.coinGranted = true;
        student.pet = student.pet || {};
        student.pet.coinsBalance = (Number(student.pet.coinsBalance) || 0) + 1;
      }
      return student;
    });
  }

  window.FirebaseStore = { database, studentsRef, migrateLocalDataOnce, migrateHomeworkStructureOnce, grantCompletedHomeworkCoins, toggleTaskCompletionAndGrant, normalizeTasks, tasksToRecord, taskTypeKey, taskTypeImage };
}());
