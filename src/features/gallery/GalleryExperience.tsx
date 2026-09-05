import { useEffect, useRef, useState } from "react";
import type { ResponsiveImage } from "@/types/media";
import { editorialRows } from "./layout";
import "./gallery.css";

type Props = {
  images: ResponsiveImage[];
};

type ViewMode = "editorial" | "contact";

function srcset(images: ResponsiveImage["sources"]["avif"]) {
  return images.map((image) => `${image.src} ${image.width}w`).join(", ");
}

function ResponsivePhoto({
  image,
  sizes,
  loading = "lazy",
  placeholder = true
}: {
  image: ResponsiveImage;
  sizes: string;
  loading?: "eager" | "lazy";
  placeholder?: boolean;
}) {
  const fallback = image.sources.jpeg.at(-1)?.src ?? image.sources.webp.at(-1)?.src ?? "";
  return (
    <picture
      className="gallery-picture"
      style={placeholder ? { backgroundImage: `url(${image.placeholder})` } : undefined}
    >
      <source type="image/avif" srcSet={srcset(image.sources.avif)} sizes={sizes} />
      <source type="image/webp" srcSet={srcset(image.sources.webp)} sizes={sizes} />
      <img
        src={fallback}
        srcSet={srcset(image.sources.jpeg)}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={image.alt}
        loading={loading}
        decoding="async"
      />
    </picture>
  );
}

export default function GalleryExperience({ images }: Props) {
  const [view, setView] = useState<ViewMode>("editorial");
  const urlReady = useRef(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showExif, setShowExif] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const openPhoto = (index: number) => {
    setShowExif(false);
    setSelected(index);
  };

  const closePhoto = () => {
    dialogRef.current?.close();
    setSelected(null);
    setShowExif(false);
  };

  const move = (direction: -1 | 1) => {
    setShowExif(false);
    setSelected((current) => {
      if (current === null) return 0;
      return (current + direction + images.length) % images.length;
    });
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!urlReady.current) {
      urlReady.current = true;
      if (url.searchParams.get("view") === "contact") setView("contact");
      return;
    }
    if (view === "contact") url.searchParams.set("view", "contact");
    else url.searchParams.delete("view");
    window.history.replaceState({}, "", url);
  }, [view]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (selected !== null && dialog && !dialog.open) dialog.showModal();
    if (selected === null || !dialog) return;

    const preloadIndexes = [
      (selected - 1 + images.length) % images.length,
      (selected + 1) % images.length
    ];
    preloadIndexes.forEach((index) => {
      const preload = new Image();
      preload.src = images[index]?.sources.webp.at(-1)?.src ?? "";
    });
  }, [images, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (selected === null) return;
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const current = selected === null ? null : images[selected];
  const rows = editorialRows(images);

  return (
    <section className="gallery-experience" aria-label="Photography collection">
      <div className="gallery-toolbar" aria-label="Gallery view">
        <div className="view-switcher">
          <button
            type="button"
            aria-pressed={view === "editorial"}
            onClick={() => setView("editorial")}
          >
            Editorial
          </button>
          <button
            type="button"
            aria-pressed={view === "contact"}
            onClick={() => setView("contact")}
          >
            Contact sheet
          </button>
        </div>
        <span>{images.length} photographs</span>
      </div>

      {view === "editorial" ? (
        <div className="editorial-gallery">
          {rows.map((row, rowIndex) => (
            <div className="editorial-row" key={row[0]!.image.id}>
              {row.map(({ image, index }) => (
                <button
                  className="editorial-photo"
                  style={{ flexGrow: image.width / image.height }}
                  type="button"
                  onClick={() => openPhoto(index)}
                  aria-label={`Open photograph ${index + 1} of ${images.length}: ${image.alt}`}
                  key={image.id}
                >
                  <ResponsivePhoto
                    image={image}
                    sizes={
                      rowIndex === 0
                        ? "(max-width: 1440px) 96vw, 1380px"
                        : "(max-width: 760px) 96vw, (max-width: 1440px) 66vw, 920px"
                    }
                    loading={index < 2 ? "eager" : "lazy"}
                  />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="contact-sheet">
          {images.map((image, index) => (
            <button
              type="button"
              onClick={() => openPhoto(index)}
              aria-label={`Open photograph ${index + 1} of ${images.length}: ${image.alt}`}
              key={image.id}
            >
              <ResponsivePhoto
                image={image}
                sizes="(max-width: 560px) 45vw, (max-width: 980px) 30vw, 22vw"
              />
            </button>
          ))}
        </div>
      )}

      {current && (
        <dialog
          ref={dialogRef}
          className="focus-dialog"
          aria-label={`Photograph ${selected! + 1} of ${images.length}`}
          onCancel={(event) => {
            event.preventDefault();
            closePhoto();
          }}
          onClose={() => setSelected(null)}
          style={{ "--focus-color": current.dominantColor } as React.CSSProperties}
        >
          <div className="focus-toolbar">
            <span>
              {String(selected! + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}
            </span>
            <div>
              {current.exif && Object.values(current.exif).some(Boolean) && (
                <button
                  type="button"
                  aria-expanded={showExif}
                  onClick={() => setShowExif((value) => !value)}
                >
                  Details
                </button>
              )}
              <button type="button" onClick={closePhoto} aria-label="Close focus view">
                Close
              </button>
            </div>
          </div>
          <div className="focus-stage">
            <button
              type="button"
              className="focus-arrow focus-arrow--previous"
              onClick={() => move(-1)}
              aria-label="Previous photograph"
            >
              ←
            </button>
            <ResponsivePhoto image={current} sizes="96vw" loading="eager" placeholder={false} />
            <button
              type="button"
              className="focus-arrow focus-arrow--next"
              onClick={() => move(1)}
              aria-label="Next photograph"
            >
              →
            </button>
          </div>
          {showExif && current.exif && (
            <dl className="exif-panel" tabIndex={0} aria-label="Photograph metadata">
              {Object.entries(current.exif).map(
                ([label, value]) =>
                  value && (
                    <div key={label}>
                      <dt>{label.replace(/([A-Z])/g, " $1")}</dt>
                      <dd>{value}</dd>
                    </div>
                  )
              )}
            </dl>
          )}
        </dialog>
      )}
    </section>
  );
}
