import type { TaskFormValues } from '@/components/dashboard/TaskForm';
import type { Task } from './db/schema';

export const EMPTY_TASK: TaskFormValues = {
  title: '',
  description: '',
  steps: '',
  audience: 'person',
  memberIds: [],
  subteamId: '',
  completion: 'once',
  dueDay: '',
  standing: false,
  needsCheck: true,
};

export function taskToForm(task: Task): TaskFormValues {
  return {
    id: task.id,
    state: task.state,
    title: task.title,
    description: task.description,
    steps: task.steps.join('\n'),
    audience: task.audience,
    memberIds: task.memberIds,
    subteamId: task.subteamId ?? '',
    completion: task.completion,
    dueDay: task.dueDay ?? '',
    standing: task.standing,
    needsCheck: task.needsCheck,
  };
}
