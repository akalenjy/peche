import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Fish, Waves, Clock, Anchor, ExternalLink, Trash2, Loader2, Plus, TrendingUp, MapPin, AlertTriangle, LogOut, MessageCircle, Send } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const ESTUAIRE_CENTER = [47.87, -4.1];

const API_KEY_STORAGE = "api-maree-key";
const DEFAULT_API_KEY = "d7581cbfad1d5f81245ddbdb304ce653";
const PRENOMS = ["Joris", "Etienne", "Adrien"];

// Points de pêche réels -> nom du site officiel le plus proche dans l'API api-maree.fr
const SPOTS = [
  { key: "combrit", label: "Anse de Combrit", siteQuery: "Bénodet" },
  { key: "sainte-marine", label: "Sainte-Marine", siteQuery: "Bénodet" },
  { key: "benodet", label: "Bénodet", siteQuery: "Bénodet" },
  { key: "loctudy", label: "Loctudy", siteQuery: "Loctudy" },
  { key: "concarneau", label: "Concarneau", siteQuery: "Concarneau" },
  { key: "guilvinec", label: "Le Guilvinec", siteQuery: "Guilvinec" },
  { key: "douarnenez", label: "Douarnenez", siteQuery: "Douarnenez" },
  { key: "audierne", label: "Audierne", siteQuery: "Audierne" },
];

const BUCKETS = [
  { label: "20–40", min: 20, max: 40, tag: "mortes-eaux" },
  { label: "40–60", min: 40, max: 60, tag: "mortes-eaux" },
  { label: "60–80", min: 60, max: 80, tag: "moyen" },
  { label: "80–100", min: 80, max: 100, tag: "vives-eaux" },
  { label: "100–120", min: 100, max: 120, tag: "vives-eaux" },
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function coefColor(c) {
  if (c == null) return "#5A6E6A";
  if (c < 45) return "#6FA8AE";
  if (c < 70) return "#7FA37A";
  if (c < 95) return "#C97B3D";
  return "#C4522A";
}

function coefTag(c) {
  if (c == null) return "coefficient non déterminé";
  if (c < 45) return "petit coef · mortes-eaux";
  if (c < 70) return "coef moyen";
  if (c < 95) return "bon coef";
  return "grand coef · vives-eaux";
}

function minutesOf(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function formatDayLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Détermine si la marée monte ou descend à l'heure donnée, à partir de la liste
// complète des pleines mers / basses mers (PM/BM) du jour.
function computeDirection(extrema, targetMin) {
  if (!extrema || extrema.length === 0) return null;
  const sorted = [...extrema].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (targetMin >= minutesOf(a.time) && targetMin <= minutesOf(b.time)) {
      return a.type === "BM" && b.type === "PM" ? "montante" : "descendante";
    }
  }
  // avant le premier ou après le dernier repère du jour
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (targetMin < minutesOf(first.time)) return first.type === "PM" ? "montante" : "descendante";
  return last.type === "PM" ? "descendante" : "montante";
}

// Carte Leaflet réutilisable : interactive (clic pour ajouter un point) en mode
// saisie, ou juste affichage de marqueurs (avec cadrage auto) en mode consultation.
function CatchMap({ center, points, onAddPoint, onRemovePoint, interactive, height = 220 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const onAddPointRef = useRef(onAddPoint);
  const onRemovePointRef = useRef(onRemovePoint);
  onAddPointRef.current = onAddPoint;
  onRemovePointRef.current = onRemovePoint;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView(center, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    if (interactive) {
      map.on("click", (e) => {
        if (onAddPointRef.current) onAddPointRef.current(e.latlng.lat, e.latlng.lng);
      });
    }
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setView(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1]]);

  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = (points || []).map((p, i) => {
      const marker = L.marker([p.lat, p.lng]).addTo(mapRef.current);
      if (p.label) marker.bindPopup(p.label);
      if (interactive) {
        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          if (onRemovePointRef.current) onRemovePointRef.current(i);
        });
      }
      return marker;
    });
    if (!interactive && points && points.length > 0) {
      mapRef.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 15 });
    }
  }, [points, interactive]);

  return <div ref={containerRef} style={{ height, width: "100%", borderRadius: 8 }} />;
}

export default function JournalPeche() {
  const [session, setSession] = useState(undefined); // undefined = pas encore vérifié, null = pas connecté
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(null);
  const [loginBusy, setLoginBusy] = useState(false);

  const [sorties, setSorties] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("log");

  const [commentaires, setCommentaires] = useState([]);
  const [openComments, setOpenComments] = useState(null); // id de la sortie dont les commentaires sont dépliés
  const [commentDraft, setCommentDraft] = useState("");
  const [commentPrenom, setCommentPrenom] = useState(PRENOMS[0]);
  const [postingComment, setPostingComment] = useState(false);

  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [sites, setSites] = useState(null); // liste brute renvoyée par /sites

  const [form, setForm] = useState({
    prenom: PRENOMS[0],
    point: SPOTS[0].key,
    date: new Date().toISOString().slice(0, 10),
    heure: new Date().toTimeString().slice(0, 5),
    heureFin: "",
    prise: true,
    nbPoissons: 1,
    espece: "",
    notes: "",
  });

  // Etat de la marée calculée automatiquement pour point + date + heure
  const [tide, setTide] = useState({ status: "idle", coefficient: null, hauteur: null, direction: null, error: null });
  const [extremaCache, setExtremaCache] = useState({}); // clé "siteId|date" -> extrema[]
  const [manualOverride, setManualOverride] = useState(false);
  const [manualCoef, setManualCoef] = useState(75);
  const [manualDirection, setManualDirection] = useState("montante");

  // Heure du pic d'activité (si plusieurs poissons pris) + marée calculée à ce moment,
  // indépendamment du calcul principal basé sur l'heure de début.
  const [heurePic, setHeurePic] = useState("");
  const [tidePic, setTidePic] = useState({ status: "idle", coefficient: null, direction: null, error: null });

  // Lieux précis de chaque prise, placés sur la carte lors de la saisie (un point par poisson)
  const [lieux, setLieux] = useState([]);

  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [detailSortie, setDetailSortie] = useState(null);

  const [predictCoef, setPredictCoef] = useState(75);
  const [predictDirection, setPredictDirection] = useState("toutes");

  // Prévision de la semaine : meilleurs moments à venir pour un point de pêche donné
  const [weekSpot, setWeekSpot] = useState(SPOTS[0].key);
  const [weekTides, setWeekTides] = useState({ status: "idle", days: [], error: null });

  // --- Authentification ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: import.meta.env.VITE_LOGIN_EMAIL,
      password: loginPassword,
    });
    setLoginBusy(false);
    if (err) setLoginError("Code incorrect.");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  // --- Chargement du carnet partagé (Supabase) + clé API perso + liste des sites ---
  async function loadSorties() {
    const { data, error: err } = await supabase
      .from("sorties")
      .select("*")
      .order("date", { ascending: false })
      .order("heure", { ascending: false });
    if (err) {
      setError("Impossible de charger le carnet partagé. Vérifie ta connexion.");
      setSorties([]);
      return;
    }
    setSorties(
      (data || []).map((row) => ({
        id: row.id,
        prenom: row.prenom,
        point: row.point,
        pointLabel: row.point_label,
        date: row.date,
        heure: row.heure ? row.heure.slice(0, 5) : row.heure,
        heureFin: row.heure_fin ? row.heure_fin.slice(0, 5) : row.heure_fin,
        coefficient: row.coefficient,
        hauteur: row.hauteur,
        coefManuel: row.coef_manuel,
        direction: row.direction,
        photoUrl: row.photo_url,
        prise: row.prise,
        nbPoissons: row.nb_poissons,
        heurePic: row.heure_pic ? row.heure_pic.slice(0, 5) : row.heure_pic,
        coefPic: row.coef_pic,
        directionPic: row.direction_pic,
        lieux: row.lieux || [],
        espece: row.espece,
        notes: row.notes,
      }))
    );
  }

  useEffect(() => {
    if (!session) return;
    loadSorties();
    const savedKey = localStorage.getItem(API_KEY_STORAGE);
    setApiKey(savedKey || DEFAULT_API_KEY);

    // Live sync : recharge la liste dès qu'un frère ajoute/supprime une sortie
    const channel = supabase
      .channel("sorties-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "sorties" }, () => {
        loadSorties();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  async function loadCommentaires() {
    const { data, error: err } = await supabase
      .from("commentaires")
      .select("*")
      .order("created_at", { ascending: true });
    if (err) return;
    setCommentaires(data || []);
  }

  useEffect(() => {
    if (!session) return;
    loadCommentaires();

    // Live sync : recharge dès qu'un frère ajoute un commentaire
    const channel = supabase
      .channel("commentaires-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "commentaires" }, () => {
        loadCommentaires();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  async function addComment(sortieId) {
    if (!commentDraft.trim()) return;
    setPostingComment(true);
    const { error: err } = await supabase
      .from("commentaires")
      .insert([{ sortie_id: sortieId, prenom: commentPrenom, texte: commentDraft.trim() }]);
    setPostingComment(false);
    if (err) {
      setError("Impossible d'enregistrer le commentaire.");
      return;
    }
    setCommentDraft("");
    loadCommentaires();
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("https://api-maree.fr/sites");
        if (!res.ok) throw new Error("sites_fetch_failed");
        const data = await res.json();
        setSites(data.sites || []);
      } catch {
        setSites([]); // reste vide : on retombera sur la saisie manuelle
      }
    })();
  }, []);

  function resolveSiteId(spotKey) {
    const spot = SPOTS.find((s) => s.key === spotKey);
    if (!spot || !sites || sites.length === 0) return null;
    const q = spot.siteQuery.toLowerCase();
    const found = sites.find((s) => (s.site_name || "").toLowerCase().includes(q));
    return found ? found.site_id : null;
  }

  function resolveSiteCoords(spotKey) {
    const spot = SPOTS.find((s) => s.key === spotKey);
    if (!spot || !sites || sites.length === 0) return ESTUAIRE_CENTER;
    const q = spot.siteQuery.toLowerCase();
    const found = sites.find((s) => (s.site_name || "").toLowerCase().includes(q));
    return found ? [found.latitude, found.longitude] : ESTUAIRE_CENTER;
  }

  // --- Récupère les pleines mers / basses mers + coefficients pour le point + la date choisis ---
  const fetchExtrema = useCallback(
    async (siteId, date) => {
      const cacheKey = `${siteId}|${date}`;
      if (extremaCache[cacheKey]) return extremaCache[cacheKey];
      const url = `https://api-maree.fr/tide-extrema?site=${encodeURIComponent(siteId)}&from=${date}&to=${date}&tz=Europe/Paris&key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `http_${res.status}`);
      }
      const data = await res.json();
      const extrema = (data.data && data.data[0] && data.data[0].extrema) || [];
      setExtremaCache((c) => ({ ...c, [cacheKey]: extrema }));
      return extrema;
    },
    [apiKey, extremaCache]
  );

  // --- Recalcule automatiquement le coefficient + la direction (montante/descendante)
  // quand le point, la date ou l'heure changent ---
  useEffect(() => {
    if (manualOverride) return;
    if (!sites) return; // liste des sites pas encore chargée
    if (!apiKey) {
      setTide({ status: "no_key", coefficient: null, hauteur: null, direction: null, error: null });
      return;
    }
    const siteId = resolveSiteId(form.point);
    if (!siteId) {
      setTide({ status: "error", coefficient: null, hauteur: null, direction: null, error: "Site introuvable pour ce point de pêche." });
      return;
    }

    let cancelled = false;
    setTide((t) => ({ ...t, status: "loading" }));

    fetchExtrema(siteId, form.date)
      .then((extrema) => {
        if (cancelled) return;
        const withCoef = extrema.filter((e) => typeof e.coef === "number");
        if (withCoef.length === 0) {
          setTide({ status: "error", coefficient: null, hauteur: null, direction: null, error: "Pas de coefficient renvoyé pour cette date." });
          return;
        }
        const targetMin = minutesOf(form.heure);
        let nearest = withCoef[0];
        let bestDiff = Infinity;
        for (const e of withCoef) {
          const diff = Math.abs(minutesOf(e.time) - targetMin);
          if (diff < bestDiff) {
            bestDiff = diff;
            nearest = e;
          }
        }
        const direction = computeDirection(extrema, targetMin);
        setTide({ status: "ok", coefficient: nearest.coef, hauteur: nearest.height, direction, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err.message === "outside_allowed_window"
            ? "Cette date est hors de la fenêtre autorisée (J-30 à J+30)."
            : err.message === "invalid_date"
            ? "Date invalide."
            : "Impossible de récupérer la marée (clé invalide, quota atteint, ou hors-ligne).";
        setTide({ status: "error", coefficient: null, hauteur: null, direction: null, error: msg });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.point, form.date, form.heure, apiKey, sites, manualOverride]);

  // --- Recalcule la marée au moment précis du pic d'activité (indépendant du
  // calcul principal, qui reste basé sur l'heure de début de la sortie) ---
  useEffect(() => {
    if (!heurePic) {
      setTidePic({ status: "idle", coefficient: null, direction: null, error: null });
      return;
    }
    if (!sites) return;
    if (!apiKey) {
      setTidePic({ status: "no_key", coefficient: null, direction: null, error: null });
      return;
    }
    const siteId = resolveSiteId(form.point);
    if (!siteId) {
      setTidePic({ status: "error", coefficient: null, direction: null, error: "Site introuvable pour ce point de pêche." });
      return;
    }

    let cancelled = false;
    setTidePic((t) => ({ ...t, status: "loading" }));

    fetchExtrema(siteId, form.date)
      .then((extrema) => {
        if (cancelled) return;
        const withCoef = extrema.filter((e) => typeof e.coef === "number");
        if (withCoef.length === 0) {
          setTidePic({ status: "error", coefficient: null, direction: null, error: "Pas de coefficient renvoyé pour cette date." });
          return;
        }
        const targetMin = minutesOf(heurePic);
        let nearest = withCoef[0];
        let bestDiff = Infinity;
        for (const e of withCoef) {
          const diff = Math.abs(minutesOf(e.time) - targetMin);
          if (diff < bestDiff) {
            bestDiff = diff;
            nearest = e;
          }
        }
        const direction = computeDirection(extrema, targetMin);
        setTidePic({ status: "ok", coefficient: nearest.coef, direction, error: null });
      })
      .catch(() => {
        if (cancelled) return;
        setTidePic({ status: "error", coefficient: null, direction: null, error: "Impossible de récupérer la marée au pic." });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heurePic, form.point, form.date, apiKey, sites]);

  // Le nombre de points sur la carte ne peut pas dépasser le nombre de poissons pris
  useEffect(() => {
    const max = form.prise ? Math.max(1, Number(form.nbPoissons) || 1) : 0;
    setLieux((pts) => (pts.length > max ? pts.slice(0, max) : pts));
  }, [form.prise, form.nbPoissons]);

  // --- Récupère les marées des 7 prochains jours pour le point choisi, pour
  // repérer les meilleurs moments à venir (onglet Probabilités) ---
  useEffect(() => {
    if (tab !== "stats") return;
    if (!sites) return;
    if (!apiKey) {
      setWeekTides({ status: "no_key", days: [], error: null });
      return;
    }
    const siteId = resolveSiteId(weekSpot);
    if (!siteId) {
      setWeekTides({ status: "error", days: [], error: "Site introuvable pour ce point de pêche." });
      return;
    }

    let cancelled = false;
    setWeekTides((w) => ({ ...w, status: "loading" }));

    const from = new Date().toISOString().slice(0, 10);
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 7);
    const to = toDate.toISOString().slice(0, 10);
    const url = `https://api-maree.fr/tide-extrema?site=${encodeURIComponent(siteId)}&from=${from}&to=${to}&tz=Europe/Paris&key=${encodeURIComponent(apiKey)}`;

    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `http_${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setWeekTides({ status: "ok", days: data.data || [], error: null });
      })
      .catch(() => {
        if (cancelled) return;
        setWeekTides({ status: "error", days: [], error: "Impossible de récupérer les marées de la semaine." });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, weekSpot, apiKey, sites]);

  const effectiveCoef = manualOverride ? Number(manualCoef) : tide.coefficient;
  const effectiveDirection = manualOverride ? manualDirection : tide.direction;
  const canSubmit = effectiveCoef != null && !saving && !uploadingPhoto;

  function handlePhotoChange(e) {
    const file = e.target.files && e.target.files[0];
    setPhotoFile(file || null);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  }

  async function addSortie(e) {
    e.preventDefault();
    if (effectiveCoef == null) return;
    const spot = SPOTS.find((s) => s.key === form.point);
    setSaving(true);
    setError(null);

    let photoUrl = null;
    if (photoFile) {
      setUploadingPhoto(true);
      const path = `${form.date}-${uid()}-${photoFile.name}`;
      const { error: uploadErr } = await supabase.storage.from("photos").upload(path, photoFile);
      setUploadingPhoto(false);
      if (uploadErr) {
        setSaving(false);
        setError("Impossible d'envoyer la photo. La sortie n'a pas été enregistrée, réessaie.");
        return;
      }
      photoUrl = supabase.storage.from("photos").getPublicUrl(path).data.publicUrl;
    }

    const { error: err } = await supabase.from("sorties").insert([
      {
        prenom: form.prenom,
        point: form.point,
        point_label: spot ? spot.label : form.point,
        date: form.date,
        heure: form.heure,
        heure_fin: form.heureFin || null,
        coefficient: effectiveCoef,
        hauteur: manualOverride ? null : tide.hauteur,
        coef_manuel: manualOverride,
        direction: effectiveDirection,
        photo_url: photoUrl,
        prise: form.prise,
        nb_poissons: form.prise ? Number(form.nbPoissons) || 0 : 0,
        heure_pic: form.prise && Number(form.nbPoissons) > 1 ? heurePic || null : null,
        coef_pic: tidePic.status === "ok" ? tidePic.coefficient : null,
        direction_pic: tidePic.status === "ok" ? tidePic.direction : null,
        lieux: form.prise && lieux.length > 0 ? lieux : null,
        espece: form.espece,
        notes: form.notes,
      },
    ]);
    setSaving(false);
    if (err) {
      setError("Impossible d'enregistrer sur le carnet partagé. Réessaie.");
      return;
    }
    setForm((f) => ({ ...f, espece: "", notes: "", nbPoissons: 1 }));
    setHeurePic("");
    setLieux([]);
    setPhotoFile(null);
    setPhotoPreview(null);
    loadSorties();
  }

  async function removeSortie(id) {
    const { error: err } = await supabase.from("sorties").delete().eq("id", id);
    if (err) {
      setError("Impossible de supprimer cette sortie.");
      return;
    }
    loadSorties();
  }

  const filteredForStats = useMemo(() => {
    if (!sorties) return [];
    if (predictDirection === "toutes") return sorties;
    return sorties.filter((s) => s.direction === predictDirection);
  }, [sorties, predictDirection]);

  const bucketStats = useMemo(() => {
    return BUCKETS.map((b) => {
      const inBucket = filteredForStats.filter((s) => s.coefficient >= b.min && s.coefficient < b.max);
      const prises = inBucket.filter((s) => s.prise).length;
      const total = inBucket.length;
      return {
        label: b.label,
        taux: total ? Math.round((prises / total) * 100) : 0,
        total,
        prises,
      };
    });
  }, [filteredForStats]);

  const prediction = useMemo(() => {
    const near = filteredForStats.filter((s) => Math.abs(s.coefficient - predictCoef) <= 10);
    const prises = near.filter((s) => s.prise).length;
    return { total: near.length, prises, taux: near.length ? Math.round((prises / near.length) * 100) : null };
  }, [filteredForStats, predictCoef]);

  const weekRecommendations = useMemo(() => {
    if (weekTides.status !== "ok") return [];
    const moments = [];
    for (const day of weekTides.days) {
      for (const e of day.extrema || []) {
        if (typeof e.coef !== "number") continue;
        const bucket = BUCKETS.find((b) => e.coef >= b.min && e.coef < b.max);
        const inBucket = bucket
          ? filteredForStats.filter((s) => s.coefficient >= bucket.min && s.coefficient < bucket.max)
          : [];
        const prises = inBucket.filter((s) => s.prise).length;
        const total = inBucket.length;
        moments.push({
          date: day.date,
          time: e.time,
          coef: e.coef,
          taux: total ? Math.round((prises / total) * 100) : null,
          total,
        });
      }
    }
    return moments.sort((a, b) => {
      if (a.taux == null && b.taux == null) return 0;
      if (a.taux == null) return 1;
      if (b.taux == null) return -1;
      return b.taux - a.taux || b.total - a.total;
    });
  }, [weekTides, filteredForStats]);

  const commentsBySortie = useMemo(() => {
    const map = {};
    for (const c of commentaires) {
      if (!map[c.sortie_id]) map[c.sortie_id] = [];
      map[c.sortie_id].push(c);
    }
    return map;
  }, [commentaires]);

  const sortiesByMonth = useMemo(() => {
    if (!sorties) return [];
    const sorted = sorties.slice().sort((a, b) => (a.date + a.heure < b.date + b.heure ? 1 : -1));
    const groups = [];
    let currentKey = null;
    for (const s of sorted) {
      const key = s.date.slice(0, 7); // YYYY-MM
      if (key !== currentKey) {
        const d = new Date(`${s.date}T12:00:00`);
        const label = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
        groups.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1), items: [] });
        currentKey = key;
      }
      groups[groups.length - 1].items.push(s);
    }
    return groups;
  }, [sorties]);

  const totalPrises = sorties ? sorties.filter((s) => s.prise).length : 0;

  const sharedStyle = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@400;500;600&family=Oswald:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
      .eyebrow { font-family: 'Oswald', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; }
      .mono { font-family: 'IBM Plex Mono', monospace; }
      .tide-track { background: linear-gradient(90deg, #6FA8AE 0%, #7FA37A 35%, #C97B3D 70%, #C4522A 100%); }
    `}</style>
  );

  // Session pas encore vérifiée
  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0B2027" }}>
        {sharedStyle}
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#7A9490" }} />
      </div>
    );
  }

  // Pas connecté -> écran de connexion
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: "#0B2027", fontFamily: "'IBM Plex Serif', Georgia, serif" }}>
        {sharedStyle}
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-lg p-6 space-y-4" style={{ background: "#122B32" }}>
          <div className="flex items-center gap-2 mb-2">
            <Anchor className="w-6 h-6" style={{ color: "#3E5C50" }} />
            <h1 className="text-xl font-semibold" style={{ color: "#F2E8D5" }}>Journal de pêche</h1>
          </div>
          <p className="text-xs" style={{ color: "#7A9490" }}>Réservé à Joris et ses frères.</p>
          <div>
            <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>Code d'accès</label>
            <input
              type="password"
              required
              autoFocus
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
            />
          </div>
          {loginError && <p className="text-xs" style={{ color: "#C4522A" }}>{loginError}</p>}
          <button
            type="submit"
            disabled={loginBusy}
            className="w-full rounded-md py-2.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "#C97B3D", color: "#0B2027" }}
          >
            {loginBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Entrer
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#0B2027", fontFamily: "'IBM Plex Serif', Georgia, serif" }}>
      {sharedStyle}

      <div className="max-w-3xl mx-auto px-5 py-10 sm:py-14">
        {/* Header */}
        <header className="mb-10 flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-xs mb-2" style={{ color: "#6FA8AE" }}>Combrit · Bénodet · Estuaire de l'Odet</p>
            <h1 className="text-3xl sm:text-4xl font-semibold" style={{ color: "#F2E8D5" }}>
              Journal de pêche à vue
            </h1>
            <p className="mt-2 text-sm" style={{ color: "#9FB3AE" }}>
              Consigné à trois, pour savoir quand sortir.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0 mt-1">
            <button onClick={handleLogout} aria-label="Se déconnecter">
              <LogOut className="w-5 h-5" style={{ color: "#3E5C50" }} />
            </button>
          </div>
        </header>

        {/* Quick stat strip */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="rounded-lg p-4" style={{ background: "#122B32" }}>
            <p className="mono text-2xl font-semibold" style={{ color: "#F2E8D5" }}>{sorties ? sorties.length : "—"}</p>
            <p className="text-xs mt-1" style={{ color: "#7A9490" }}>sorties consignées</p>
          </div>
          <div className="rounded-lg p-4" style={{ background: "#122B32" }}>
            <p className="mono text-2xl font-semibold" style={{ color: "#F2E8D5" }}>{sorties ? totalPrises : "—"}</p>
            <p className="text-xs mt-1" style={{ color: "#7A9490" }}>avec prise</p>
          </div>
          <div className="rounded-lg p-4" style={{ background: "#122B32" }}>
            <p className="mono text-2xl font-semibold" style={{ color: "#F2E8D5" }}>
              {sorties && sorties.length ? Math.round((totalPrises / sorties.length) * 100) : "—"}%
            </p>
            <p className="text-xs mt-1" style={{ color: "#7A9490" }}>taux de réussite global</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b" style={{ borderColor: "#1D3A41" }}>
          {[
            { id: "log", label: "Nouvelle sortie", icon: Plus },
            { id: "history", label: "Carnet", icon: Waves },
            { id: "stats", label: "Probabilités", icon: TrendingUp },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="eyebrow text-xs px-3 py-3 flex items-center gap-1.5 border-b-2 transition-colors"
              style={{
                borderColor: tab === t.id ? "#C97B3D" : "transparent",
                color: tab === t.id ? "#F2E8D5" : "#6E8985",
              }}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 text-sm rounded-md px-3 py-2" style={{ background: "#3A1F1A", color: "#E3A98E" }}>
            {error}
          </div>
        )}

        {sorties === null && (
          <div className="flex items-center gap-2 text-sm" style={{ color: "#7A9490" }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement du carnet…
          </div>
        )}

        {/* NEW ENTRY */}
        {sorties !== null && tab === "log" && (
          <form onSubmit={addSortie} className="rounded-lg p-5 space-y-5" style={{ background: "#122B32" }}>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>Pêcheur</label>
                <select
                  value={form.prenom}
                  onChange={(e) => setForm((f) => ({ ...f, prenom: e.target.value }))}
                  className="w-full rounded-md px-3 py-2 text-sm outline-none"
                  style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
                >
                  {PRENOMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>Espèce</label>
                <input
                  value={form.espece}
                  onChange={(e) => setForm((f) => ({ ...f, espece: e.target.value }))}
                  placeholder="bar, mulet…"
                  className="w-full rounded-md px-3 py-2 text-sm outline-none"
                  style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
                />
              </div>
            </div>

            <div>
              <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>
                <MapPin className="w-3 h-3 inline mr-1" />Point de pêche
              </label>
              <select
                value={form.point}
                onChange={(e) => setForm((f) => ({ ...f, point: e.target.value }))}
                className="w-full rounded-md px-3 py-2 text-sm outline-none"
                style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
              >
                {SPOTS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-md px-3 py-2 text-sm mono outline-none"
                style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>
                  <Clock className="w-3 h-3 inline mr-1" />Heure de début
                </label>
                <input
                  type="time"
                  value={form.heure}
                  onChange={(e) => setForm((f) => ({ ...f, heure: e.target.value }))}
                  className="w-full rounded-md px-3 py-2 text-sm mono outline-none"
                  style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
                />
              </div>
              <div>
                <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>
                  <Clock className="w-3 h-3 inline mr-1" />Heure de fin
                </label>
                <input
                  type="time"
                  value={form.heureFin}
                  onChange={(e) => setForm((f) => ({ ...f, heureFin: e.target.value }))}
                  className="w-full rounded-md px-3 py-2 text-sm mono outline-none"
                  style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
                />
              </div>
            </div>

            {/* COEFFICIENT — calculé automatiquement, non modifiable */}
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="eyebrow text-xs" style={{ color: "#7A9490" }}>Coefficient de marée</label>
                {!manualOverride && tide.status === "loading" && (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: "#7A9490" }}>
                    <Loader2 className="w-3 h-3 animate-spin" /> calcul…
                  </span>
                )}
              </div>

              {!manualOverride ? (
                <>
                  <div
                    className="w-full rounded-md px-3 py-3 flex items-center justify-between"
                    style={{ background: "#0B2027", border: "1px solid #1D3A41" }}
                  >
                    <span className="mono text-2xl font-semibold" style={{ color: coefColor(tide.coefficient) }}>
                      {tide.coefficient != null ? tide.coefficient : "—"}
                    </span>
                    <span className="text-xs text-right" style={{ color: "#7A9490" }}>
                      {tide.coefficient != null ? coefTag(tide.coefficient) : "\u00A0"}
                      {tide.direction && (
                        <><br />marée {tide.direction}</>
                      )}
                      {tide.hauteur != null && (
                        <><br />hauteur {tide.hauteur.toFixed(2)} m</>
                      )}
                    </span>
                  </div>
                  <div className="tide-track h-1.5 rounded-full mt-2" />

                  {tide.status === "no_key" && (
                    <p className="text-xs mt-2 flex items-start gap-1.5" style={{ color: "#C97B3D" }}>
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      Ajoute ta clé API (⚙️ en haut) pour calculer le coefficient automatiquement.
                    </p>
                  )}
                  {tide.status === "error" && (
                    <div className="text-xs mt-2" style={{ color: "#C97B3D" }}>
                      <p className="flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {tide.error}
                      </p>
                      <button
                        type="button"
                        onClick={() => setManualOverride(true)}
                        className="underline mt-1"
                      >
                        Saisir le coefficient à la main pour cette fois
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="mono text-lg font-semibold" style={{ color: coefColor(manualCoef) }}>{manualCoef}</span>
                    <button type="button" onClick={() => setManualOverride(false)} className="text-xs underline" style={{ color: "#7A9490" }}>
                      revenir au calcul automatique
                    </button>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="120"
                    value={manualCoef}
                    onChange={(e) => setManualCoef(e.target.value)}
                    className="w-full accent-orange-600"
                  />
                  <div className="tide-track h-1.5 rounded-full mt-1" />
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs" style={{ color: "#7A9490" }}>{coefTag(Number(manualCoef))} · saisie manuelle</p>
                    <div className="flex gap-1">
                      {["montante", "descendante"].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setManualDirection(d)}
                          className="text-xs px-2 py-0.5 rounded"
                          style={{
                            background: manualDirection === d ? "#3E5C50" : "transparent",
                            color: manualDirection === d ? "#F2E8D5" : "#7A9490",
                            border: "1px solid #1D3A41",
                          }}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div>
              <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>Photo (optionnel)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="w-full text-sm"
                style={{ color: "#9FB3AE" }}
              />
              {photoPreview && (
                <img src={photoPreview} alt="aperçu" className="mt-2 rounded-md max-h-40 object-cover" />
              )}
              {uploadingPhoto && (
                <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: "#7A9490" }}>
                  <Loader2 className="w-3 h-3 animate-spin" /> envoi de la photo…
                </p>
              )}
            </div>

            <div>
              <label className="eyebrow text-xs block mb-2" style={{ color: "#7A9490" }}>Résultat</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, prise: true }))}
                  className="flex-1 rounded-md py-2 text-sm flex items-center justify-center gap-1.5 transition-colors"
                  style={{
                    background: form.prise ? "#3E5C50" : "#0B2027",
                    color: form.prise ? "#F2E8D5" : "#7A9490",
                    border: "1px solid #1D3A41",
                  }}
                >
                  <Fish className="w-4 h-4" /> Poisson pris
                </button>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, prise: false }))}
                  className="flex-1 rounded-md py-2 text-sm transition-colors"
                  style={{
                    background: !form.prise ? "#3A2A1D" : "#0B2027",
                    color: !form.prise ? "#F2E8D5" : "#7A9490",
                    border: "1px solid #1D3A41",
                  }}
                >
                  Bredouille
                </button>
              </div>
              {form.prise && (
                <div className="mt-3">
                  <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>Nombre de poissons</label>
                  <input
                    type="number"
                    min="1"
                    value={form.nbPoissons}
                    onChange={(e) => setForm((f) => ({ ...f, nbPoissons: e.target.value }))}
                    className="w-full rounded-md px-3 py-2 text-sm mono outline-none"
                    style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
                  />
                </div>
              )}
              {form.prise && Number(form.nbPoissons) > 1 && (
                <div className="mt-3">
                  <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>
                    <Clock className="w-3 h-3 inline mr-1" />Heure du pic d'activité
                  </label>
                  <input
                    type="time"
                    value={heurePic}
                    onChange={(e) => setHeurePic(e.target.value)}
                    className="w-full rounded-md px-3 py-2 text-sm mono outline-none"
                    style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
                  />
                  {tidePic.status === "ok" && (
                    <p className="text-xs mt-1.5" style={{ color: coefColor(tidePic.coefficient) }}>
                      coef {tidePic.coefficient} · marée {tidePic.direction}
                    </p>
                  )}
                  {tidePic.status === "loading" && (
                    <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: "#7A9490" }}>
                      <Loader2 className="w-3 h-3 animate-spin" /> calcul…
                    </p>
                  )}
                  {tidePic.status === "error" && (
                    <p className="text-xs mt-1.5" style={{ color: "#C97B3D" }}>{tidePic.error}</p>
                  )}
                </div>
              )}
            </div>

            {form.prise && (
              <div>
                <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>
                  <MapPin className="w-3 h-3 inline mr-1" />
                  Lieu(x) de prise ({lieux.length}/{Math.max(1, Number(form.nbPoissons) || 1)})
                </label>
                <p className="text-xs mb-1.5" style={{ color: "#7A9490" }}>
                  Clique sur la carte à l'endroit de chaque prise. Clique sur un point pour le retirer.
                </p>
                <CatchMap
                  center={resolveSiteCoords(form.point)}
                  points={lieux}
                  interactive
                  onAddPoint={(lat, lng) => {
                    const max = Math.max(1, Number(form.nbPoissons) || 1);
                    setLieux((pts) => (pts.length >= max ? pts : [...pts, { lat, lng }]));
                  }}
                  onRemovePoint={(i) => setLieux((pts) => pts.filter((_, idx) => idx !== i))}
                />
              </div>
            )}

            <div>
              <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="courant, météo, appât…"
                rows={2}
                className="w-full rounded-md px-3 py-2 text-sm outline-none resize-none"
                style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
              />
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-md py-2.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "#C97B3D", color: "#0B2027" }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Enregistrer la sortie
            </button>
          </form>
        )}

        {/* HISTORY */}
        {sorties !== null && tab === "history" && (
          <>
          <div className="space-y-2">
            {sorties.length === 0 && (
              <p className="text-sm text-center py-10" style={{ color: "#7A9490" }}>
                Le carnet est vide. Enregistre ta première sortie.
              </p>
            )}
            {sortiesByMonth.map((group) => (
              <div key={group.key}>
                <p className="eyebrow text-xs mt-6 mb-2 first:mt-0" style={{ color: "#6FA8AE" }}>{group.label}</p>
                <div className="space-y-2">
                  {group.items.map((s) => {
                    const comments = commentsBySortie[s.id] || [];
                    const isOpen = openComments === s.id;
                    return (
                      <div
                        key={s.id}
                        className="rounded-lg p-4 flex flex-col gap-3"
                        style={{ background: "#122B32", borderLeft: `3px solid ${coefColor(s.coefficient)}` }}
                      >
                        <div
                          className="flex items-center justify-between gap-3 cursor-pointer"
                          onClick={() => setDetailSortie(s)}
                        >
                          {s.photoUrl && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLightbox(s.photoUrl);
                              }}
                              className="shrink-0 rounded-md overflow-hidden"
                              style={{ width: 56, height: 56 }}
                            >
                              <img src={s.photoUrl} alt="prise" className="w-full h-full object-cover" />
                            </button>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="mono text-xs" style={{ color: "#7A9490" }}>
                                {s.date} · {s.heure}{s.heureFin ? `–${s.heureFin}` : ""}
                              </span>
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#0B2027", color: "#9FB3AE" }}>
                                {s.prenom}
                              </span>
                              <span className="text-xs flex items-center gap-1" style={{ color: "#7A9490" }}>
                                <MapPin className="w-3 h-3" /> {s.pointLabel || s.point}
                              </span>
                              {s.direction && (
                                <span className="text-xs" style={{ color: "#6FA8AE" }}>{s.direction}</span>
                              )}
                              {s.prise ? (
                                <span className="text-xs flex items-center gap-1" style={{ color: "#7FA37A" }}>
                                  <Fish className="w-3 h-3" /> {s.nbPoissons ? `${s.nbPoissons}× ` : ""}{s.espece || "prise"}
                                </span>
                              ) : (
                                <span className="text-xs" style={{ color: "#8C7355" }}>bredouille</span>
                              )}
                              {s.coefManuel && (
                                <span className="text-xs" style={{ color: "#5A6E6A" }}>(coef manuel)</span>
                              )}
                              {s.heurePic && (
                                <span className="text-xs" style={{ color: "#C97B3D" }}>
                                  pic {s.heurePic}{s.coefPic != null ? ` · coef ${s.coefPic}` : ""}
                                </span>
                              )}
                            </div>
                            {s.notes && <p className="text-sm truncate" style={{ color: "#C7D3D0" }}>{s.notes}</p>}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="mono text-lg font-semibold" style={{ color: coefColor(s.coefficient) }}>
                              {s.coefficient}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeSortie(s.id);
                              }}
                              aria-label="Supprimer"
                            >
                              <Trash2 className="w-4 h-4" style={{ color: "#5A6E6A" }} />
                            </button>
                          </div>
                        </div>

                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenComments(isOpen ? null : s.id);
                              setCommentDraft("");
                            }}
                            className="text-xs flex items-center gap-1.5"
                            style={{ color: "#7A9490" }}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            {comments.length > 0 ? `${comments.length} commentaire${comments.length > 1 ? "s" : ""}` : "Commenter"}
                          </button>

                          {isOpen && (
                            <div className="mt-2.5 space-y-2">
                              {comments.map((c) => (
                                <div key={c.id} className="text-xs rounded-md px-2.5 py-1.5" style={{ background: "#0B2027" }}>
                                  <span className="mono" style={{ color: "#9FB3AE" }}>{c.prenom}</span>{" "}
                                  <span style={{ color: "#C7D3D0" }}>{c.texte}</span>
                                </div>
                              ))}
                              <div className="flex gap-1.5">
                                <select
                                  value={commentPrenom}
                                  onChange={(e) => setCommentPrenom(e.target.value)}
                                  className="text-xs rounded-md px-1.5 outline-none"
                                  style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
                                >
                                  {PRENOMS.map((p) => (
                                    <option key={p} value={p}>{p}</option>
                                  ))}
                                </select>
                                <input
                                  value={commentDraft}
                                  onChange={(e) => setCommentDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") addComment(s.id);
                                  }}
                                  placeholder="Ton commentaire…"
                                  className="flex-1 min-w-0 rounded-md px-2 py-1 text-xs outline-none"
                                  style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => addComment(s.id)}
                                  disabled={postingComment || !commentDraft.trim()}
                                  aria-label="Envoyer"
                                  className="rounded-md px-2 disabled:opacity-50"
                                  style={{ background: "#3E5C50" }}
                                >
                                  {postingComment ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "#F2E8D5" }} />
                                  ) : (
                                    <Send className="w-3.5 h-3.5" style={{ color: "#F2E8D5" }} />
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          </>
        )}

        {lightbox && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: "rgba(11,32,39,0.92)" }}
            onClick={() => setLightbox(null)}
          >
            <img src={lightbox} alt="prise en grand" className="max-w-full max-h-full rounded-lg" />
          </div>
        )}

        {detailSortie && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(11,32,39,0.92)" }}
            onClick={() => setDetailSortie(null)}
          >
            <div
              className="w-full max-w-lg rounded-lg p-5 space-y-4"
              style={{ background: "#122B32", maxHeight: "90vh", overflowY: "auto" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="mono text-xs" style={{ color: "#7A9490" }}>
                    {detailSortie.date} · {detailSortie.heure}{detailSortie.heureFin ? `–${detailSortie.heureFin}` : ""}
                  </p>
                  <p className="text-lg font-semibold" style={{ color: "#F2E8D5" }}>
                    {detailSortie.prenom} · {detailSortie.pointLabel || detailSortie.point}
                  </p>
                </div>
                <button onClick={() => setDetailSortie(null)} aria-label="Fermer" className="text-xs shrink-0" style={{ color: "#7A9490" }}>
                  Fermer
                </button>
              </div>

              {detailSortie.photoUrl && (
                <img src={detailSortie.photoUrl} alt="prise" className="w-full rounded-lg max-h-72 object-cover" />
              )}

              <div className="flex flex-wrap gap-3 text-xs" style={{ color: "#C7D3D0" }}>
                <span className="mono" style={{ color: coefColor(detailSortie.coefficient) }}>coef {detailSortie.coefficient}</span>
                {detailSortie.direction && <span>marée {detailSortie.direction}</span>}
                {detailSortie.hauteur != null && <span>hauteur {detailSortie.hauteur.toFixed(2)} m</span>}
                {detailSortie.prise ? (
                  <span className="flex items-center gap-1" style={{ color: "#7FA37A" }}>
                    <Fish className="w-3 h-3" /> {detailSortie.nbPoissons ? `${detailSortie.nbPoissons}× ` : ""}{detailSortie.espece || "prise"}
                  </span>
                ) : (
                  <span style={{ color: "#8C7355" }}>bredouille</span>
                )}
                {detailSortie.heurePic && (
                  <span style={{ color: "#C97B3D" }}>
                    pic {detailSortie.heurePic}{detailSortie.coefPic != null ? ` · coef ${detailSortie.coefPic}` : ""}
                  </span>
                )}
              </div>

              {detailSortie.notes && (
                <p className="text-sm" style={{ color: "#C7D3D0" }}>{detailSortie.notes}</p>
              )}

              <div>
                <p className="eyebrow text-xs mb-2" style={{ color: "#7A9490" }}>Lieu(x) de prise</p>
                {detailSortie.lieux && detailSortie.lieux.length > 0 ? (
                  <CatchMap
                    center={[detailSortie.lieux[0].lat, detailSortie.lieux[0].lng]}
                    points={detailSortie.lieux}
                    interactive={false}
                    height={220}
                  />
                ) : (
                  <p className="text-sm" style={{ color: "#7A9490" }}>Aucun lieu précis enregistré pour cette sortie.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STATS */}
        {sorties !== null && tab === "stats" && (
          <div className="space-y-8">
            <div className="flex gap-2">
              {[
                { key: "toutes", label: "Toutes marées" },
                { key: "montante", label: "Montante" },
                { key: "descendante", label: "Descendante" },
              ].map((d) => (
                <button
                  key={d.key}
                  onClick={() => setPredictDirection(d.key)}
                  className="text-xs px-3 py-1.5 rounded-full"
                  style={{
                    background: predictDirection === d.key ? "#3E5C50" : "#122B32",
                    color: predictDirection === d.key ? "#F2E8D5" : "#7A9490",
                    border: "1px solid #1D3A41",
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <div className="rounded-lg p-5" style={{ background: "#122B32" }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="eyebrow text-xs" style={{ color: "#7A9490" }}>
                  Meilleurs moments cette semaine
                </p>
                <select
                  value={weekSpot}
                  onChange={(e) => setWeekSpot(e.target.value)}
                  className="text-xs rounded-md px-2 py-1 outline-none"
                  style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
                >
                  {SPOTS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>

              {weekTides.status === "no_key" && (
                <p className="text-xs flex items-start gap-1.5" style={{ color: "#C97B3D" }}>
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Ajoute ta clé API (⚙️ en haut) pour voir les marées à venir.
                </p>
              )}
              {weekTides.status === "loading" && (
                <p className="text-xs flex items-center gap-1.5" style={{ color: "#7A9490" }}>
                  <Loader2 className="w-3 h-3 animate-spin" /> calcul des marées de la semaine…
                </p>
              )}
              {weekTides.status === "error" && (
                <p className="text-xs flex items-start gap-1.5" style={{ color: "#C97B3D" }}>
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {weekTides.error}
                </p>
              )}

              {weekTides.status === "ok" && weekRecommendations.length > 0 && (
                <>
                  {weekRecommendations[0].taux != null ? (
                    <div className="rounded-md p-3 mb-3" style={{ background: "#0B2027", border: "1px solid #1D3A41" }}>
                      <p className="text-xs mb-1" style={{ color: "#7A9490" }}>Meilleur moment prévu</p>
                      <p className="text-sm" style={{ color: "#C7D3D0" }}>
                        <span className="mono font-semibold" style={{ color: "#F2E8D5" }}>
                          {formatDayLabel(weekRecommendations[0].date)} vers {weekRecommendations[0].time}
                        </span>{" "}
                        · coef <span className="mono" style={{ color: coefColor(weekRecommendations[0].coef) }}>{weekRecommendations[0].coef}</span>{" "}
                        · <span className="mono font-semibold" style={{ color: "#7FA37A" }}>{weekRecommendations[0].taux}%</span> de réussite historique
                        {predictDirection !== "toutes" ? ` en marée ${predictDirection}` : ""} sur {weekRecommendations[0].total} sortie(s) similaire(s).
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs mb-3" style={{ color: "#7A9490" }}>
                      Pas encore assez de sorties enregistrées à des coefficients comparables pour prédire le meilleur moment.
                    </p>
                  )}
                  <div className="space-y-1.5">
                    {weekRecommendations.map((m, i) => (
                      <div key={`${m.date}-${m.time}`} className="flex items-center justify-between text-xs px-2 py-1.5 rounded" style={{ background: i === 0 ? "rgba(201,123,61,0.12)" : "transparent" }}>
                        <span style={{ color: "#C7D3D0" }}>{formatDayLabel(m.date)} · {m.time}</span>
                        <span className="flex items-center gap-2">
                          <span className="mono" style={{ color: coefColor(m.coef) }}>coef {m.coef}</span>
                          <span className="mono" style={{ color: m.taux != null ? "#7FA37A" : "#5A6E6A" }}>
                            {m.taux != null ? `${m.taux}%` : "—"}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-lg p-5" style={{ background: "#122B32" }}>
              <p className="eyebrow text-xs mb-3" style={{ color: "#7A9490" }}>
                Taux de réussite par coefficient
              </p>
              {filteredForStats.length === 0 ? (
                <p className="text-sm" style={{ color: "#7A9490" }}>Pas encore assez de données.</p>
              ) : (
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer>
                    <BarChart data={bucketStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1D3A41" />
                      <XAxis dataKey="label" tick={{ fill: "#7A9490", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#7A9490", fontSize: 11 }} unit="%" width={40} />
                      <Tooltip
                        contentStyle={{ background: "#0B2027", border: "1px solid #1D3A41", borderRadius: 8 }}
                        labelStyle={{ color: "#F2E8D5" }}
                        formatter={(v, n, p) => [`${v}% (${p.payload.prises}/${p.payload.total})`, "taux de prise"]}
                      />
                      <Bar dataKey="taux" radius={[4, 4, 0, 0]}>
                        {bucketStats.map((b, i) => (
                          <Cell key={i} fill={coefColor((BUCKETS[i].min + BUCKETS[i].max) / 2)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-lg p-5" style={{ background: "#122B32" }}>
              <p className="eyebrow text-xs mb-3" style={{ color: "#7A9490" }}>
                Tu prévois de sortir avec quel coefficient ?
              </p>
              <div className="flex items-baseline justify-between mb-2">
                <span className="mono text-2xl font-semibold" style={{ color: coefColor(predictCoef) }}>
                  {predictCoef}
                </span>
                <span className="text-xs" style={{ color: "#7A9490" }}>{coefTag(predictCoef)}</span>
              </div>
              <input
                type="range"
                min="20"
                max="120"
                value={predictCoef}
                onChange={(e) => setPredictCoef(Number(e.target.value))}
                className="w-full mb-4"
              />
              {prediction && prediction.total > 0 ? (
                <p className="text-sm" style={{ color: "#C7D3D0" }}>
                  Sur <span className="mono">{prediction.total}</span> sortie(s) à un coefficient proche (± 10)
                  {predictDirection !== "toutes" ? ` en marée ${predictDirection}` : ""}, vous avez ramené du poisson{" "}
                  <span className="mono font-semibold" style={{ color: "#7FA37A" }}>{prediction.taux}%</span> du temps
                  ({prediction.prises}/{prediction.total}).
                </p>
              ) : (
                <p className="text-sm" style={{ color: "#7A9490" }}>
                  Aucune sortie enregistrée dans ces conditions pour l'instant. Plus vous consignez de sorties (même bredouilles), plus la proba sera fiable.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
