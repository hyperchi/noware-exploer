/* Outdoor air abstraction.
 *
 * The provider contract lets the
 * recommendation engine can tell "outdoor data unavailable" apart from
 * "outdoor particles are low". Missing data is never read as good.
 * OpenMeteoOutdoorProvider connects coarse, opt-in regional model data.
 *
 * @typedef {Object} OutdoorAir
 * @property {'available'|'unavailable'} status
 * @property {string} [reason]
 * @property {number|null} pm25  µg/m³
 * @property {number|null} aqi
 * @property {number|null} temperatureC
 * @property {number|null} humidity
 * @property {string|null} pollen  'low'|'moderate'|'high'|null
 * @property {boolean|null} wildfireSmoke
 * @property {number|null} fetchedAt
 * @property {string} [provider]
 */

export function unavailableOutdoor(reason = 'Outdoor air data is not connected for this home yet.') {
  return { status: 'unavailable', reason, pm25: null, aqi: null, temperatureC: null, humidity: null, pollen: null, wildfireSmoke: null, fetchedAt: null, provider: 'none' };
}

/** A provider has async getOutdoor({householdId, location}) returning OutdoorAir. */
export class NoOutdoorProvider {
  async getOutdoor() {
    return unavailableOutdoor();
  }
}

/** Fixed values, for scenarios and tests. */
export class StaticOutdoorProvider {
  constructor(values) {
    this.values = values;
  }
  async getOutdoor() {
    return { ...unavailableOutdoor(), status: 'available', provider: 'static', fetchedAt: Date.now() / 1000, ...this.values };
  }
}

/**
 * Is opening a window likely to help with particles?
 * true / false when outdoor data says so, null when unknown.
 */
export function outdoorCleanerThanIndoors(outdoor, indoorPm25) {
  if (!outdoor || outdoor.status !== 'available' || outdoor.pm25 == null) return null;
  if (indoorPm25 == null) return outdoor.pm25 <= 12;
  return outdoor.pm25 < indoorPm25 * 0.7 && outdoor.pm25 <= 35.4;
}

export function outdoorPollutionHigh(outdoor) {
  if (!outdoor || outdoor.status !== 'available') return null;
  if (outdoor.wildfireSmoke) return true;
  if (outdoor.pm25 != null) return outdoor.pm25 > 35.4;
  if (outdoor.aqi != null) return outdoor.aqi > 100;
  return null;
}
