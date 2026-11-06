/** One sound output of the PC, as the list in the player bar shows it. */
export interface OutputDevice {
  /** The browser's device id. '' is the system default. */
  id: string
  label: string
}

/** The part of the browser's device entry that is used here. */
export interface RawDevice {
  kind: string
  deviceId: string
  label: string
}

export const SYSTEM_DEFAULT_LABEL = 'System default'

/** The browser starts the label of its two virtual entries with these words. */
const DEFAULT_PREFIX = /^default\s*-\s*/i

/**
 * The outputs to offer. "System default" always comes first; it follows whatever Windows uses. The browser also
 * lists a virtual "Communications" entry, which is left out because it is the same as a real device.
 * A device without a name shows as "Output 1", "Output 2" and so on.
 */
export function listOutputs(devices: RawDevice[]): OutputDevice[] {
  const outputs = devices.filter((device) => device.kind === 'audiooutput')
  const defaultEntry = outputs.find((device) => device.deviceId === 'default')
  const behind = defaultEntry?.label.replace(DEFAULT_PREFIX, '').trim() ?? ''
  const list: OutputDevice[] = [{ id: '', label: behind === '' ? SYSTEM_DEFAULT_LABEL : `${SYSTEM_DEFAULT_LABEL}: ${behind}` }]
  let unnamed = 0
  for (const device of outputs) {
    if (device.deviceId === 'default' || device.deviceId === 'communications' || device.deviceId === '') continue
    unnamed += device.label === '' ? 1 : 0
    list.push({ id: device.deviceId, label: device.label === '' ? `Output ${unnamed}` : device.label })
  }
  return list
}

/** The output to use now: the wanted one if it is still connected, otherwise the system default. */
export function pickOutput(wanted: string, list: OutputDevice[]): { id: string; lost: boolean } {
  if (wanted === '' || list.some((device) => device.id === wanted)) return { id: wanted, lost: false }
  return { id: '', lost: true }
}
