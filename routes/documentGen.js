const express = require('express');
const router = express.Router();
const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } = require('docx');
const { fetchStaticMapImage } = require('../lib/staticMap');

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || '';
const MAP_SIZE = '600x400';
const MAP_WIDTH_PX = 600;
const MAP_HEIGHT_PX = 400;

const HOTEL_SPOT_LABELS = {
  convenienceStores: 'コンビニ',
  supermarkets: 'スーパー',
  restaurants: 'レストラン',
  izakaya: '居酒屋',
  bars: 'バー',
  travelSpots: '観光スポット',
};
// One marker color per category so the combined map stays legible — picked
// to be visually distinct from the route/worksite colors used elsewhere
// (blue/red) and from each other.
const HOTEL_SPOT_COLORS = {
  convenienceStores: 'green',
  supermarkets: 'purple',
  restaurants: 'orange',
  izakaya: 'yellow',
  bars: 'gray',
  travelSpots: 'brown',
};
const HOTEL_SPOT_MAP_LIMIT = 3; // per category, keeps the combined map under the marker cap

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

function formatDistance(meters) {
  if (meters == null) return '—';
  return `${(meters / 1000).toFixed(1)}km`;
}

function heading(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

function line(text) {
  return new Paragraph({ children: [new TextRun(text)] });
}

function imageParagraph(buffer) {
  return new Paragraph({
    children: [new ImageRun({
      type: 'png',
      data: buffer,
      transformation: { width: MAP_WIDTH_PX / 2, height: MAP_HEIGHT_PX / 2 },
    })],
  });
}

async function fetchMap(opts) {
  return fetchStaticMapImage({ size: MAP_SIZE, scale: 2, ...opts }, GOOGLE_MAPS_KEY);
}

function buildWorksiteMarkers(worksite, hospitals) {
  const markers = [{ lat: worksite.lat, lng: worksite.lng, label: 'S', color: 'red' }];
  hospitals.slice(0, 3).forEach((h, i) => {
    if (h.lat != null && h.lng != null) {
      markers.push({ lat: h.lat, lng: h.lng, label: String(i + 1), color: 'blue' });
    }
  });
  return markers;
}

function buildHotelSpotMarkers(hotel, hotelSpots) {
  const markers = [{ lat: hotel.lat, lng: hotel.lng, label: 'H', color: 'red' }];
  for (const [key, color] of Object.entries(HOTEL_SPOT_COLORS)) {
    (hotelSpots[key] || []).slice(0, HOTEL_SPOT_MAP_LIMIT).forEach(s => {
      if (s.lat != null && s.lng != null) markers.push({ lat: s.lat, lng: s.lng, color });
    });
  }
  return markers;
}

function hotelSpotLines(hotelSpots) {
  const paragraphs = [];
  for (const [key, label] of Object.entries(HOTEL_SPOT_LABELS)) {
    const items = (hotelSpots[key] || []).slice(0, HOTEL_SPOT_MAP_LIMIT);
    const text = items.length
      ? items.map(s => `${s.name}${s.distance != null ? `(${s.distance}km)` : ''}`).join('、')
      : '見つかりませんでした';
    paragraphs.push(line(`${label}: ${text}`));
  }
  return paragraphs;
}

function hospitalLines(hospitals) {
  if (!hospitals.length) return [line('見つかりませんでした')];
  return hospitals.slice(0, 3).map(h =>
    line(`${h.name} / ${h.address || '住所不明'} / ${h.distance != null ? h.distance + 'km' : '距離不明'}`));
}

// POST /api/document/generate — builds a .docx content block (worksite
// location, both route legs, hotel contact info, hotel surroundings, nearby
// hospitals) from data the frontend already fetched this session. Does NOT
// re-call Places/Routes APIs for that data — see docs/feature-roadmap.md for
// why (avoids re-paying for calls the user already triggered via the
// ルート確認/周辺スポット buttons). The only new cost here is the Static Maps
// calls below, a separate cheaper SKU from Places.
router.post('/generate', async (req, res) => {
  if (!GOOGLE_MAPS_KEY) return res.status(500).json({ error: 'GOOGLE_MAPS_KEY is not configured' });

  const { worksite, company, hotel, routeToWorksite, routeToHotel, hospitals, hotelSpots } = req.body || {};
  if (!worksite || !hotel) return res.status(400).json({ error: 'worksite and hotel are required' });

  const safeHospitals = hospitals || [];
  const safeHotelSpots = hotelSpots || {};

  try {
    const [worksiteMapBuf, toWorksiteMapBuf, toHotelMapBuf, hotelSpotsMapBuf] = await Promise.all([
      fetchMap({ markers: buildWorksiteMarkers(worksite, safeHospitals) }),
      routeToWorksite && company
        ? fetchMap({
            markers: [
              { lat: company.lat, lng: company.lng, label: 'A', color: 'blue' },
              { lat: worksite.lat, lng: worksite.lng, label: 'B', color: 'red' },
            ],
            path: routeToWorksite.path || [],
          })
        : null,
      routeToHotel
        ? fetchMap({
            markers: [
              { lat: worksite.lat, lng: worksite.lng, label: 'A', color: 'blue' },
              { lat: hotel.lat, lng: hotel.lng, label: 'B', color: 'red' },
            ],
            path: routeToHotel.path || [],
          })
        : null,
      fetchMap({ markers: buildHotelSpotMarkers(hotel, safeHotelSpots) }),
    ]);

    const children = [
      heading('現場所在地'),
      line(worksite.address || `${worksite.lat}, ${worksite.lng}`),
      imageParagraph(worksiteMapBuf),
    ];

    if (toWorksiteMapBuf && routeToWorksite) {
      children.push(
        heading('会社 → 現場 ルート'),
        line(`${formatDistance(routeToWorksite.distanceMeters)} ・ 約${formatDuration(routeToWorksite.durationSeconds)}`),
        imageParagraph(toWorksiteMapBuf),
      );
    }

    if (toHotelMapBuf && routeToHotel) {
      children.push(
        heading('現場 → ホテル ルート'),
        line(`${formatDistance(routeToHotel.distanceMeters)} ・ 約${formatDuration(routeToHotel.durationSeconds)}`),
        imageParagraph(toHotelMapBuf),
      );
    }

    children.push(
      heading('宿'),
      line(hotel.name || ''),
      line(hotel.address || ''),
      line(hotel.phone || '電話番号不明'),
      line(hotel.price != null ? `${hotel.price}` : '料金不明'),

      heading('周辺スポット'),
      ...hotelSpotLines(safeHotelSpots),
      imageParagraph(hotelSpotsMapBuf),

      heading('最寄病院'),
      ...hospitalLines(safeHospitals),
    );

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);

    const filename = `keikakusho_${(hotel.name || 'hotel').replace(/[^\w　-鿿]/g, '_')}.docx`;
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
