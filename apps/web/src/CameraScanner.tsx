import { useEffect, useRef, useState } from "react";

type Detector = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};
type DetectorConstructor = new (options: { formats: string[] }) => Detector;
const detectorConstructor = () =>
  (window as unknown as { BarcodeDetector?: DetectorConstructor })
    .BarcodeDetector;

export function acceptCameraScan(
  code: string,
  previous: { code: string; at: number },
  now = Date.now(),
) {
  return (
    code.length >= 3 && !(previous.code === code && now - previous.at < 1500)
  );
}

export default function CameraScanner({
  onScan,
  close,
}: {
  onScan: (code: string) => void;
  close: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    closeButton = useRef<HTMLButtonElement>(null),
    previouslyFocused = useRef<HTMLElement | null>(null),
    stream = useRef<MediaStream | undefined>(undefined),
    frame = useRef<number | undefined>(undefined),
    recent = useRef({ code: "", at: 0 }),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [deviceId, setDeviceId] = useState(""),
    [error, setError] = useState("");
  const onScanRef = useRef(onScan),
    closeRef = useRef(close);
  useEffect(() => {
    onScanRef.current = onScan;
    closeRef.current = close;
  }, [onScan, close]);
  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      stop();
      closeRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, []);
  const stop = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
  };
  useEffect(() => {
    let active = true;
    const Detector = detectorConstructor();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Caméra indisponible dans ce navigateur.");
      return stop;
    }
    if (!Detector) {
      setError(
        "Lecture de codes par caméra non prise en charge. Utilisez le scanner USB ou la recherche manuelle.",
      );
      return stop;
    }
    const start = async () => {
      stop();
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!active) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
        const cameras = (
          await navigator.mediaDevices.enumerateDevices()
        ).filter((d) => d.kind === "videoinput");
        setDevices(cameras);
        const detector = new Detector({
          formats: ["ean_8", "ean_13", "upc_a", "upc_e", "code_128", "qr_code"],
        });
        const scan = async () => {
          if (!active || !video.current) return;
          try {
            const result = await detector.detect(video.current);
            const code = result[0]?.rawValue.trim();
            if (code && acceptCameraScan(code, recent.current)) {
              recent.current = { code, at: Date.now() };
              onScanRef.current(code);
              stop();
              closeRef.current();
              return;
            }
          } catch {
            /* transient frames are ignored */
          }
          frame.current = requestAnimationFrame(scan);
        };
        frame.current = requestAnimationFrame(scan);
      } catch (reason) {
        const denied =
          reason instanceof DOMException && reason.name === "NotAllowedError";
        setError(
          denied
            ? "Permission caméra refusée. Autorisez-la dans le navigateur ou utilisez le scanner USB."
            : "Impossible d’ouvrir la caméra sélectionnée.",
        );
      }
    };
    void start();
    return () => {
      active = false;
      stop();
    };
  }, [deviceId]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="camera-scanner-title" data-scanner-blocking="true">
      <section className="card camera">
        <div className="title">
          <h2 id="camera-scanner-title">Scanner un code</h2>
          <button
            ref={closeButton}
            type="button"
            onClick={() => {
              stop();
              close();
            }}
          >
            Fermer
          </button>
        </div>
        {error ? (
          <div className="error">{error}</div>
        ) : (
          <video ref={video} playsInline muted />
        )}
        {devices.length > 1 && (
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            <option value="">Caméra arrière préférée</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Caméra ${i + 1}`}
              </option>
            ))}
          </select>
        )}
        <p>Aucune image n’est envoyée au serveur.</p>
      </section>
    </div>
  );
}
