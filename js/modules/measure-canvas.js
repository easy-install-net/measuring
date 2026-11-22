const STAMP_GROUPS = [
  {
    name: "電掣",
    items: ["13A單蘇", "13A孖蘇", "燈掣", "雙控掣", "數據掣", "電視掣", "冷氣掣", "曲架掣", "電箱"]
  },
  {
    name: "水煤",
    items: ["冷水喉", "熱水喉", "去水位", "地台去水", "煤氣掣", "煤氣錶"]
  },
  {
    name: "收口/結構",
    items: ["收口條", "見光板", "石膏線", "燈槽", "假天花底", "橫樑陣位", "柱位", "暗門", "地腳線"]
  }
];

export class MeasureCanvas {
  constructor(container, imageUrl, initialData, rulerColors, onSave) {
    this.container = container;
    this.imageUrl = imageUrl;

    if (Array.isArray(initialData)) {
      this.lines = JSON.parse(JSON.stringify(initialData));
      this.markers = [];
      this.paths = [];
      this.walls = [];
    } else {
      this.lines = JSON.parse(JSON.stringify(initialData?.lines || []));
      this.markers = JSON.parse(JSON.stringify(initialData?.markers || []));
      this.paths = JSON.parse(JSON.stringify(initialData?.paths || initialData?.strokes || []));
      this.walls = JSON.parse(JSON.stringify(initialData?.walls || []));
    }

    const rawColors = (rulerColors && rulerColors.length)
      ? rulerColors.map(c => typeof c === "string" ? c : c.hex)
      : ["#EF4444", "#2563EB", "#16A34A", "#D97706", "#9333EA", "#111827"];
    this.colors = rawColors.filter(Boolean);
    this.activeColor = this.colors[0] || "#EF4444";
    this.onSave = onSave;

    this.tool = "RULER";
    this.activeStamp = "13A孖蘇";
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    this.history = [];
    this.redoStack = [];
    this.selectedLineIdx = -1;
    this.activeSegIdx = -1;
    this.keypadVal = "";

    this.img = new Image();
    this.img.crossOrigin = "anonymous";
    this.img.onload = () => {
      this.natW = this.img.naturalWidth || 1200;
      this.natH = this.img.naturalHeight || 900;
      this.normalizeLegacyCoordinates();
      this.initUI();
      this.fitToScreen();
      this.render();
    };
    this.img.src = imageUrl;
  }

  normalizeLegacyCoordinates() {
    const isNorm = (v) => typeof v === "number" && v > 0 && v <= 1.05;

    this.lines.forEach(l => {
      if (isNorm(l.x1) && isNorm(l.y1) && isNorm(l.x2) && isNorm(l.y2)) {
        l.x1 *= this.natW;
        l.y1 *= this.natH;
        l.x2 *= this.natW;
        l.y2 *= this.natH;
      }
    });

    this.markers.forEach(m => {
      if (isNorm(m.x) && isNorm(m.y)) {
        m.x *= this.natW;
        m.y *= this.natH;
      }
    });

    this.paths.forEach(p => {
      const pts = Array.isArray(p) ? p : (p.points || p.pts || []);
      pts.forEach(pt => {
        if (Array.isArray(pt) && isNorm(pt[0]) && isNorm(pt[1])) {
          pt[0] *= this.natW;
          pt[1] *= this.natH;
        } else if (pt && isNorm(pt.x) &&
