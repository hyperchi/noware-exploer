/* Air-intelligence vocabulary shared by the engine, the server and the UI.
 *
 * Everything here is plain data. The engine is dependency-free ES modules so
 * the same code runs in Node (server, gateway, tests) and in the browser
 * (public/dashboard imports it from /dashboard/js/intelligence/, which the
 * Vite build copies from this directory).
 *
 * Principle: numbers are evidence, conclusions and actions are the product.
 * Every value the engine emits is tagged with how it was obtained:
 *   measured  - read from a sensor channel the device vouches for
 *   derived   - arithmetic on measurements (baselines, ratios, slopes)
 *   inferred  - a hypothesis about the world (a likely source), with confidence
 *   context   - something the household told us (pets, room type, equipment)
 */

/** Channel keys used throughout. The device decides which exist (capabilities). */
export const CHANNELS = Object.freeze([
  'pm1', 'pm25', 'pm4', 'pm10', 'tvoc', 'vocLevel', 'eco2', 'co2', 'temp', 'hum', 'lux',
]);

/** Overall room / home status, worst active risk wins. */
export const STATUS = Object.freeze(['excellent', 'good', 'needs_attention', 'poor', 'unhealthy']);
export const STATUS_LABEL = Object.freeze({
  excellent: 'Air is excellent',
  good: 'Air is good',
  needs_attention: 'Air needs attention',
  poor: 'Air is poor',
  unhealthy: 'Air is unhealthy',
});
export const STATUS_SHORT = Object.freeze({
  excellent: 'Excellent', good: 'Good', needs_attention: 'Needs attention', poor: 'Poor', unhealthy: 'Unhealthy',
});

export const EVENT_CATEGORIES = Object.freeze(['particles', 'voc', 'ventilation', 'humidity', 'temperature', 'mixed']);
export const EVENT_STATES = Object.freeze(['active', 'improving', 'resolved']);
export const SOURCES = Object.freeze([
  'cooking', 'cleaning', 'outdoor_pollution', 'dust', 'combustion', 'poor_ventilation', 'shower', 'pet_activity', 'unknown',
]);
export const SOURCE_LABEL = Object.freeze({
  cooking: 'Cooking fumes',
  cleaning: 'Cleaning products or fragrance',
  outdoor_pollution: 'Outdoor air coming in',
  dust: 'Dust disturbance',
  combustion: 'Fine-particle source (cooking, candles or smoke)',
  poor_ventilation: 'Not enough fresh air',
  shower: 'Shower or steam',
  pet_activity: 'Pet activity',
  unknown: 'Unknown source',
});

export const EVIDENCE_KINDS = Object.freeze(['measured', 'derived', 'inferred', 'context']);
export const CONFIDENCE_LEVELS = Object.freeze(['low', 'medium', 'high']);

export const DATA_SOURCES = Object.freeze(['physical', 'simulated', 'replay']);
export const DEVICE_STATES = Object.freeze(['online', 'warming_up', 'stale', 'offline', 'fault', 'no_device']);

export const RECOMMENDATION_LEVELS = Object.freeze(['diy', 'check', 'contractor']);
export const ACTION_TYPES = Object.freeze([
  'exhaust', 'ventilate', 'close_windows', 'purifier', 'bathroom_fan', 'wait', 'reduce_source',
  'check_filter', 'check_purifier', 'check_vents', 'check_moisture', 'contact_contractor', 'investigate',
]);

export const ROLES = Object.freeze(['homeowner', 'contractor', 'admin']);

export const INSIGHT_CATEGORIES = Object.freeze([
  'filtration', 'ventilation', 'humidity_control', 'airflow', 'maintenance', 'source_control', 'investigation',
]);
export const SIGNAL_STATUSES = Object.freeze(['new', 'reviewed', 'contacted', 'resolved', 'dismissed']);

export const CONTACT_ACTIONS = Object.freeze(['message', 'call', 'request_service', 'schedule', 'share_air_report']);
export const SERVICE_EVENT_TYPES = Object.freeze(['maintenance', 'repair', 'filter_change', 'equipment_installation', 'inspection']);

/**
 * @typedef {Object} DeviceCapabilities
 * @property {boolean} pm1
 * @property {boolean} pm25
 * @property {boolean} pm4
 * @property {boolean} pm10
 * @property {boolean} tvoc
 * @property {boolean} vocLevel
 * @property {boolean} eco2
 * @property {boolean} trueCo2
 * @property {boolean} temperature
 * @property {boolean} humidity
 * @property {boolean} illuminance
 * @property {'true'|'estimated'|'none'} co2Kind
 */

/**
 * @typedef {Object} Evidence
 * @property {'measured'|'derived'|'inferred'|'context'} kind
 * @property {string} text  plain-English statement
 * @property {boolean} supports  true = for the hypothesis, false = against
 * @property {number} weight  contribution to the score, 0..1
 * @property {string} [channel]
 */

/**
 * @typedef {Object} Confidence
 * @property {number} score  0..1
 * @property {'low'|'medium'|'high'} level
 * @property {Evidence[]} evidence
 * @property {{source: string, score: number, label: string}[]} [alternatives]
 */

/**
 * @typedef {Object} AirEvent
 * @property {string} id
 * @property {string} deviceKey
 * @property {string} [roomId]
 * @property {number} startedAt  unix seconds
 * @property {number} [endedAt]
 * @property {'active'|'improving'|'resolved'} state
 * @property {string} category  EVENT_CATEGORIES
 * @property {string} channel  the channel that drives it
 * @property {{value:number,t:number}} peak
 * @property {number} startValue
 * @property {number} currentValue
 * @property {{low:number,high:number,median:number,kind:string}} baseline
 * @property {string} severity  STATUS
 * @property {{source:string,label:string,confidence:Confidence,alternatives:object[]}} [hypothesis]
 * @property {object[]} recommendations
 * @property {number} [recoveryMinutes]
 * @property {'physical'|'simulated'|'replay'} source
 */

export const DEFAULT_HOUSEHOLD_PROFILE = Object.freeze({
  sensitivities: { allergies: false, asthma: false, youngChildren: false, elderlyResidents: false },
  pets: { hasPets: false, types: [] },
  concerns: { pollen: false, dust: false, petAllergens: false, smoke: false, cooking: false, mold: false, odors: false },
});

export const ROOM_TYPES = Object.freeze(['living', 'bedroom', 'kitchen', 'nursery', 'bathroom', 'office', 'basement', 'other']);
export const EQUIPMENT_TYPES = Object.freeze([
  'hvac', 'hvac_filter', 'whole_home_air_cleaner', 'portable_purifier', 'humidifier', 'dehumidifier',
  'fresh_air_ventilator', 'kitchen_exhaust', 'bathroom_exhaust', 'thermostat', 'operable_windows',
]);
