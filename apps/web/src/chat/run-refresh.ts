import {
  ARTIFACT_ACTIVITY,
  BROWSER_SCREENSHOT_ACTIVITY,
  EventType,
  MEMBER_MESSAGE_ACTIVITY,
  ORCHESTRATION_ACTIVITY,
  OUTPOST_DRAFT_ACTIVITY,
  isApprovalEvent,
  isTaskActivity,
  type RunEvent,
} from '@spark-outpost/contracts';

const CHAT_ACTIVITIES: ReadonlySet<string> = new Set([
  ORCHESTRATION_ACTIVITY,
  MEMBER_MESSAGE_ACTIVITY,
  BROWSER_SCREENSHOT_ACTIVITY,
  OUTPOST_DRAFT_ACTIVITY,
  ARTIFACT_ACTIVITY,
]);

export function refreshesChat(event: RunEvent): boolean {
  if (isTaskActivity(event) || isApprovalEvent(event)) return true;
  return event.type === EventType.ACTIVITY_SNAPSHOT && CHAT_ACTIVITIES.has(event.activityType);
}
