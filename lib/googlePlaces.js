const { withRetry } = require('./retry');
const { haversine } = require('./haversine');

const PLACES_BASE = 'https://places.googleapis.com/v1/places:searchNearby';
// Deliberately NOT requesting places.rating: it's "Enterprise" SKU tier
// (1,000 free calls/month), while everything below — accessibilityOptions,
// photos, primaryTypeDisplayName — is "Pro" tier or cheaper (5,000 free
// calls/month). Adding rating back would drop every call made through this
// shared helper (hospitals, dining, route stops, hotel-spots) to the
// stingier free tier just to show a star rating in a few list rows — not
// worth it. See docs/feature-roadmap.md for the cost breakdown. Backup of
// the pre-change version: backups/2026-06-19-pre-cost-optimization/.
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.types,places.accessibilityOptions,places.photos,places.primaryTypeDisplayName';

// Places API (New) Nearby Search. `includedTypes`/`excludedTypes` use the
// New API's type table (e.g. 'hospital', 'restaurant', 'bar',
// 'japanese_izakaya_restaurant') — see place-types docs, not the legacy
// `type=` vocabulary.
async function searchNearby(lat, lng, radius, { includedTypes, excludedTypes, maxResultCount = 20 } = {}, apiKey) {
  return withRetry(async () => {
    const body = {
      includedTypes,
      ...(excludedTypes ? { excludedTypes } : {}),
      maxResultCount,
      languageCode: 'ja',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
    };
    const r = await fetch(PLACES_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    const json = await r.json();
    if (json.error) throw new Error(`Places API: ${json.error.status} ${json.error.message}`);
    return json.places || [];
  }, { attempts: 3, delayMs: 800 });
}

function shapePlace(place, originLat, originLng) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  return {
    name: place.displayName?.text || '',
    address: place.formattedAddress || '',
    lat, lng,
    distance: (lat != null && lng != null) ? Math.round(haversine(originLat, originLng, lat, lng) * 100) / 100 : null,
    mapLink: place.googleMapsUri || '',
    // Wheelchair-accessible parking implies a parking lot exists, so true is
    // a reliable positive signal. false/missing just means Google hasn't
    // recorded this attribute for the place — not confirmation there's no
    // parking — so callers should only assert the positive case in the UI.
    hasParkingLot: place.accessibilityOptions?.wheelchairAccessibleParking ?? null,
    // A category label (e.g. "コンビニエンスストア"), not a written
    // description — see docs/feature-roadmap.md for why (the real editorial
    // description field is a much pricier SKU tier).
    description: place.primaryTypeDisplayName?.text || null,
    // Resource name for /api/poi/photo, e.g. "places/ABC123/photos/XYZ789".
    // null when the place has no photo. This is just a free reference —
    // fetching the actual image is a separate, real per-photo cost, so
    // callers should only request it lazily, not for every place shown.
    photoRef: place.photos?.[0]?.name || null,
  };
}

module.exports = { searchNearby, shapePlace };
