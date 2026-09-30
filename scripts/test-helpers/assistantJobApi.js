// Model a short durable POST and independent provider work in screen tests.
// The root foreground reconciler is simulated when each provider completes.
export function assistantJobApi(sendAssistantMessage) {
  const jobs = new Map();
  return {
    async createAssistantJob(token, id, data) {
      if (!jobs.has(id)) {
        jobs.set(id, { id, status: 'running' });
        void Promise.resolve().then(() => sendAssistantMessage(data, token)).then(result => {
          jobs.set(id, { id, status:'complete', result });
        }, error => { jobs.set(id, { id, status:'failed', error: error.code || 'deepSeekUnavailable' }); }).then(async () => {
          // Let the POST acknowledgment finish before simulating the next poll.
          for (let step = 0; step < 40; step++) await Promise.resolve();
          const module = require('@react-native-async-storage/async-storage');
          const storage = module.default || module;
          const record = storage.setItem.mock.calls.find(([key, raw]) => key.startsWith('@outdoor_fit_ai_jobs_v1:') && JSON.parse(raw).some(x => x.id === id));
          if (record) {
            const task = JSON.parse(record[1]).find(x => x.id === id);
            await require('../../utils/assistantJobs').resumeAssistantJobs({owner:task.scope.owner,token});
          }
        });
      }
      return jobs.get(id);
    },
    async getAssistantJob(_token,id) { return jobs.get(id); },
  };
}
