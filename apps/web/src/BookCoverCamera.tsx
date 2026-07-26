import { useCallback, useEffect, useRef, useState } from "react";

export default function BookCoverCamera({
  close,
  captured,
}: {
  close: () => void;
  captured: (file: File) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
  }, []);
  const dismiss = useCallback(() => {
    stop();
    close();
  }, [close, stop]);

  useEffect(() => {
    let active = true;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", escape);
    void navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      })
      .then(async (media) => {
        if (!active) return media.getTracks().forEach((track) => track.stop());
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
      })
      .catch(() =>
        setError("Impossible d’ouvrir la caméra. Vérifiez son autorisation."),
      );
    return () => {
      active = false;
      window.removeEventListener("keydown", escape);
      stop();
      previousFocus.current?.focus();
    };
  }, [dismiss, stop]);

  const capture = () => {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    canvas.getContext("2d")?.drawImage(source, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError("La photo n’a pas pu être capturée.");
        captured(new File([blob], "couverture.jpg", { type: "image/jpeg" }));
        dismiss();
      },
      "image/jpeg",
      0.9,
    );
  };

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-camera-title"
      data-scanner-blocking="true"
    >
      <section className="card camera book-camera">
        <div className="title">
          <h2 id="book-camera-title">Photographier le livre</h2>
          <button ref={closeButton} type="button" onClick={dismiss}>Fermer</button>
        </div>
        {error ? <div className="error" role="alert">{error}</div> : (
          <div className="book-camera-frame">
            <video ref={video} playsInline muted />
            <span aria-hidden="true" />
          </div>
        )}
        <p>Placez toute la couverture dans le cadre, bien droite et sans reflet.</p>
        <button type="button" disabled={Boolean(error)} onClick={capture}>
          Prendre la photo
        </button>
      </section>
    </div>
  );
}
