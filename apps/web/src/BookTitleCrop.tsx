import { useEffect, useRef, useState, type PointerEvent } from "react";

export type CropSelection = { x: number; y: number; width: number; height: number };

export default function BookTitleCrop({
  imageUrl,
  onCrop,
  onReset,
}: {
  imageUrl: string;
  onCrop: (file: File) => void;
  onReset: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const onResetRef = useRef(onReset);
  const [selection, setSelection] = useState<CropSelection>();
  onResetRef.current = onReset;

  useEffect(() => {
    setSelection(undefined);
    return () => onResetRef.current();
  }, [imageUrl]);

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    startRef.current = start;
    setSelection({ ...start, width: 0, height: 0 });
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    const current = point(event);
    setSelection({
      x: Math.min(startRef.current.x, current.x),
      y: Math.min(startRef.current.y, current.y),
      width: Math.abs(current.x - startRef.current.x),
      height: Math.abs(current.y - startRef.current.y),
    });
  };
  const end = () => {
    startRef.current = undefined;
  };
  const crop = () => {
    const image = imageRef.current;
    if (!image || !selection || selection.width < 0.03 || selection.height < 0.03) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * selection.width));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * selection.height));
    canvas
      .getContext("2d")
      ?.drawImage(
        image,
        image.naturalWidth * selection.x,
        image.naturalHeight * selection.y,
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    canvas.toBlob((blob) => {
      if (blob) onCrop(new File([blob], "title-region.png", { type: "image/png" }));
    }, "image/png");
  };
  const reset = () => {
    setSelection(undefined);
    onReset();
  };

  return (
    <div className="book-title-crop">
      <p>Encadrez uniquement le titre du livre pour améliorer la lecture.</p>
      <div
        className="book-title-crop-stage"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <img ref={imageRef} src={imageUrl} alt="Couverture à recadrer" draggable={false} />
        {selection && (
          <span
            className="book-title-crop-selection"
            style={{
              left: `${selection.x * 100}%`,
              top: `${selection.y * 100}%`,
              width: `${selection.width * 100}%`,
              height: `${selection.height * 100}%`,
            }}
          />
        )}
      </div>
      <div className="actions">
        <button
          type="button"
          disabled={!selection || selection.width < 0.03 || selection.height < 0.03}
          onClick={crop}
        >
          Lire cette zone
        </button>
        <button type="button" className="secondary" onClick={reset}>
          Réinitialiser la zone
        </button>
      </div>
    </div>
  );
}
