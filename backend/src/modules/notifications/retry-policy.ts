export const retryBackoffInMinutes = [0, 1, 5, 15, 30, 60] as const;

export const notificationWorkerMaxAttempts = retryBackoffInMinutes.length + 1;
