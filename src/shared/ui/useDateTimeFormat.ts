import { useContext, useSyncExternalStore } from "react";
import { ControllerContext } from "../../app/useController";
import { formatDate, formatDateTime } from "../time";

const subscribeDefault = () => () => {};
const autoTimeZone = () => "";
const localeDefault = () => "locale" as const;

/** Standalone presentation uses browser defaults without a Controller provider. */
export function useDateTimeFormat() {
  const controller = useContext(ControllerContext);
  const dateFormat = useSyncExternalStore(controller?.settings.subscribe ?? subscribeDefault,
    controller ? () => controller.settings.get().dateFormat : localeDefault,
    controller ? () => controller.settings.get().dateFormat : localeDefault);
  const timeFormat = useSyncExternalStore(controller?.settings.subscribe ?? subscribeDefault,
    controller ? () => controller.settings.get().timeFormat : localeDefault,
    controller ? () => controller.settings.get().timeFormat : localeDefault);
  const timeZone = useSyncExternalStore(controller?.settings.subscribe ?? subscribeDefault,
    controller ? () => controller.settings.get().timeZone : autoTimeZone,
    controller ? () => controller.settings.get().timeZone : autoTimeZone);
  return {
    date: (at: number) => formatDateTime(at, { dateFormat, timeFormat, timeZone }),
    dateOnly: (at: number) => formatDate(at, dateFormat, timeZone),
  };
}
