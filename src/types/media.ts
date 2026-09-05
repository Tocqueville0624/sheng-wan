export type ImageCandidate = {
  src: string;
  width: number;
};

export type PublicExif = {
  camera?: string;
  lens?: string;
  focalLength?: string;
  aperture?: string;
  shutterSpeed?: string;
  iso?: string;
  capturedAt?: string;
};

export type ResponsiveImage = {
  id: string;
  alt: string;
  width: number;
  height: number;
  aspectRatio: number;
  dominantColor: string;
  placeholder: string;
  sources: {
    avif: ImageCandidate[];
    webp: ImageCandidate[];
    jpeg: ImageCandidate[];
  };
  exif?: PublicExif;
};

export type MediaManifest = {
  generatedAt: string;
  home: ResponsiveImage;
  hugo: ResponsiveImage[];
  gallery: ResponsiveImage[];
};
