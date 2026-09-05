export type MediaDefinition = {
  id: string;
  source: string;
  outputGroup: "home" | "hugo" | "gallery";
  alt: string;
  widths: number[];
  includeExif?: boolean;
};

const galleryWidths = [720, 1440, 2400];
const portraitWidths = [480, 800, 1280];

export const mediaDefinitions: MediaDefinition[] = [
  {
    id: "sheng-portrait",
    source: "Sheng_Main.PNG",
    outputGroup: "home",
    alt: "Portrait of Sheng Wan outdoors on a ship deck under a blue sky.",
    widths: portraitWidths
  },
  {
    id: "hugo-main",
    source: "Hugo_Main.jpg",
    outputGroup: "hugo",
    alt: "Hugo, a long-haired tabby cat, sits beside a small classical bust.",
    widths: portraitWidths
  },
  {
    id: "hugo-close-portrait",
    source: "Hugo1.HEIC",
    outputGroup: "hugo",
    alt: "Close portrait of Hugo resting on an office chair.",
    widths: portraitWidths
  },
  {
    id: "hugo-backpack",
    source: "Hugo2.HEIC",
    outputGroup: "hugo",
    alt: "A younger Hugo sits inside an open backpack and looks upward.",
    widths: portraitWidths
  },
  {
    id: "hugo-window",
    source: "Hugo3.HEIC",
    outputGroup: "hugo",
    alt: "Hugo watches through a glass door.",
    widths: portraitWidths
  },
  {
    id: "hugo-lounging",
    source: "Hugo4.HEIC",
    outputGroup: "hugo",
    alt: "Hugo lounges on a carpet with one paw tucked under their chin.",
    widths: portraitWidths
  },
  {
    id: "hugo-cushions",
    source: "Hugo5.HEIC",
    outputGroup: "hugo",
    alt: "Hugo peeks out from beneath navy cushions on a sofa.",
    widths: portraitWidths
  },
  {
    id: "canyon-afterglow",
    source: "Photos/1-9.JPG",
    outputGroup: "gallery",
    alt: "Sunset light washes layered red cliffs and mesas beneath a pastel sky.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "milky-way-desert-road",
    source: "Photos/1-35.JPG",
    outputGroup: "gallery",
    alt: "The Milky Way arcs over a winding desert road and dark mountain ridge.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "brooklyn-bridge-dusk",
    source: "Photos/1-25.JPG",
    outputGroup: "gallery",
    alt: "The Brooklyn Bridge crosses a dusk skyline centered on One World Trade Center.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "mountain-cloud",
    source: "Photos/1-30.JPG",
    outputGroup: "gallery",
    alt: "Pink-lit cloud drifts across a snow-streaked mountain above dark fir trees.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "tall-ship-rigging",
    source: "Photos/1-32.JPG",
    outputGroup: "gallery",
    alt: "Tall-ship masts and rigging form a lattice against peach and blue evening clouds.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "mountain-light",
    source: "Photos/1-27.JPG",
    outputGroup: "gallery",
    alt: "A shaft of late light reaches jagged mountain peaks above a shadowed valley and lake.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "volcanic-peak-haze",
    source: "Photos/2-10.JPG",
    outputGroup: "gallery",
    alt: "A snow-covered volcanic peak rises through warm haze beyond dark rocky ridges.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "alpine-reflection",
    source: "Photos/2-3.JPG",
    outputGroup: "gallery",
    alt: "A rugged snow-capped mountain and surrounding forest reflect in a still alpine lake.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "aurora-horizon",
    source: "Photos/2-6.JPG",
    outputGroup: "gallery",
    alt: "Bands of pink, orange, and green aurora glow above a rocky mountain horizon under dense stars.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "milky-way-mountain-road",
    source: "Photos/2-5.JPG",
    outputGroup: "gallery",
    alt: "The Milky Way rises above a curving mountain road bordered by snow and rock.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "snowfield-observers",
    source: "Photos/1-16.JPG",
    outputGroup: "gallery",
    alt: "Two people sit on a bright snowfield beneath a vast wall of jagged white peaks.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "total-solar-eclipse",
    source: "Photos/2-46.JPG",
    outputGroup: "gallery",
    alt: "The black disk of a total solar eclipse is ringed by a white corona and a bright diamond of sunlight.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "waterfront-windows",
    source: "Photos/1-15.JPG",
    outputGroup: "gallery",
    alt: "Floor-to-ceiling windows frame a hazy waterfront and mountains in pale morning light.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "blossoms-and-row-houses",
    source: "Photos/1-2.JPG",
    outputGroup: "gallery",
    alt: "Soft pink blossoms blur across pastel blue and yellow row-house façades.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "horse-at-sunset",
    source: "Photos/1-3.JPG",
    outputGroup: "gallery",
    alt: "A dark horse stands behind a wooden fence with jagged mountains glowing at sunset.",
    widths: galleryWidths,
    includeExif: true
  },
  {
    id: "winter-volcano",
    source: "Photos/1-11.JPG",
    outputGroup: "gallery",
    alt: "A solitary snow-covered volcanic peak rises above rolling white ridges beneath a deep blue sky.",
    widths: galleryWidths,
    includeExif: true
  }
];
