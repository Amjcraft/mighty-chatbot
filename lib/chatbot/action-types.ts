// Base action event type. Host apps extend this with their own action union.
//
// Example:
//   type RescheduleEvent = { type: "reschedule_event"; payload: { eventId: string; newDate: string } }
//   type HostAppAction = RescheduleEvent | CreateTaskEvent
export type ActionEvent = {
  type: string;
  payload: Record<string, unknown>;
};
