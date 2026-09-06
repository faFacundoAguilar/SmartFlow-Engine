const MS_PER_MINUTE = 60_000;

/**
 * Minutos restantes hasta el deadline, medidos desde `now`.
 * Negativo significa que ya está vencido. `null` si la tarea no tiene deadline.
 */
export function minutesUntilDeadline(task, now = new Date()) {
  if (!task.deadline) return null;
  const deadline = new Date(task.deadline);
  return (deadline.getTime() - now.getTime()) / MS_PER_MINUTE;
}

/** Una tarea está atrasada si su deadline ya pasó y no está completada. */
export function isOverdue(task, now = new Date()) {
  const remaining = minutesUntilDeadline(task, now);
  return remaining !== null && remaining < 0 && task.status !== 'completed';
}
