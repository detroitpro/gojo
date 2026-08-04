export type {
  QueueRunningItem,
  QueueSnapshot,
  QueueWaitingItem,
  SchedulingPolicy,
} from "@gojo/contracts/types";

export interface UpcomingScheduleSeries {
  id: string;
  name: string;
  agentName: string | null;
  timezone: string;
  enabled: boolean;
  color: string;
  fires: string[];
}

export interface SchedulesUpcomingResult {
  horizonHours: number;
  from: string;
  to: string;
  schedules: UpcomingScheduleSeries[];
}
