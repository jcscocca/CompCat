export type TileConfig = {
  url: string;
  attribution: string;
  maxZoom: number;
  provider: string;
};

// Muted "Positron" basemap so the data layer (pins, rings) reads clearly.
// Carto's usage policy covers light public web traffic; swap `defaultTileConfig`
// for a keyed provider (MapTiler / Stadia) before high-volume production use.
export const defaultTileConfig: TileConfig = {
  url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 19,
  provider: "carto-positron",
};
