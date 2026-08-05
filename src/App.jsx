import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Fish, Waves, Clock, Anchor, ExternalLink, Trash2, Loader2, Plus, TrendingUp, MapPin, Settings, AlertTriangle, LogOut } from "lucide-react";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const API_KEY_STORAGE = "api-maree-key";
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

export default function JournalPeche() {
  const [session, setSession] = useState(undefined); // undefined = pas encore vérifié, null = pas connecté
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(null);
  const [loginBusy, setLoginBusy] = useState(false);

  const [sorties, setSorties] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("log");

  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [sites, setSites] = useState(null); // liste brute renvoyée par /sites

  const [form, setForm] = useState({
    prenom: PRENOMS[0],
    point: SPOTS[0].key,
    date: new Date().toISOString().slice(0, 10),
    heure: new Date().toTimeString().slice(0, 5),
    prise: true,
    espece: "",
    notes: "",
  });

  // Etat de la marée calculée automatiquement pour point + date + heure
  const [tide, setTide] = useState({ status: "idle", coefficient: null, hauteur: null, direction: null, error: null });
  const [extremaCache, setExtremaCache] = useState({}); // clé "siteId|date" -> extrema[]
  const [manualOverride, setManualOverride] = useState(false);
  const [manualCoef, setManualCoef] = useState(75);
  const [manualDirection, setManualDirection] = useState("montante");

  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const [predictCoef, setPredictCoef] = useState(75);
  const [predictDirection, setPredictDirection] = useState("toutes");

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
        coefficient: row.coefficient,
        hauteur: row.hauteur,
        coefManuel: row.coef_manuel,
        direction: row.direction,
        photoUrl: row.photo_url,
        prise: row.prise,
        espece: row.espece,
        notes: row.notes,
      }))
    );
  }

  useEffect(() => {
    if (!session) return;
    loadSorties();
    const savedKey = localStorage.getItem(API_KEY_STORAGE);
    if (savedKey) setApiKey(savedKey);

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

  function saveApiKey(key) {
    setApiKey(key);
    localStorage.setItem(API_KEY_STORAGE, key);
  }

  function resolveSiteId(spotKey) {
    const spot = SPOTS.find((s) => s.key === spotKey);
    if (!spot || !sites || sites.length === 0) return null;
    const q = spot.siteQuery.toLowerCase();
    const found = sites.find((s) => (s.site_name || "").toLowerCase().includes(q));
    return found ? found.site_id : null;
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
        coefficient: effectiveCoef,
        hauteur: manualOverride ? null : tide.hauteur,
        coef_manuel: manualOverride,
        direction: effectiveDirection,
        photo_url: photoUrl,
        prise: form.prise,
        espece: form.espece,
        notes: form.notes,
      },
    ]);
    setSaving(false);
    if (err) {
      setError("Impossible d'enregistrer sur le carnet partagé. Réessaie.");
      return;
    }
    setForm((f) => ({ ...f, espece: "", notes: "" }));
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
            <button onClick={() => setShowSettings((s) => !s)} aria-label="Réglages">
              <Settings className="w-6 h-6" style={{ color: "#3E5C50" }} />
            </button>
            <button onClick={handleLogout} aria-label="Se déconnecter">
              <LogOut className="w-5 h-5" style={{ color: "#3E5C50" }} />
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="rounded-lg p-4 mb-8 space-y-2" style={{ background: "#122B32", border: "1px solid #1D3A41" }}>
            <p className="eyebrow text-xs" style={{ color: "#7A9490" }}>Clé API marée (api-maree.fr)</p>
            <p className="text-xs" style={{ color: "#7A9490" }}>
              Le coefficient est calculé automatiquement à partir de vraies données de marée. Crée un compte gratuit sur{" "}
              <a href="https://api-maree.fr/register" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#C97B3D" }}>
                api-maree.fr
              </a>{" "}
              puis colle ta clé ici (elle reste sur ce PC).
            </p>
            <input
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
              placeholder="colle ta clé API ici"
              className="w-full rounded-md px-3 py-2 text-sm mono outline-none"
              style={{ background: "#0B2027", color: "#F2E8D5", border: "1px solid #1D3A41" }}
            />
          </div>
        )}

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

            <div className="grid grid-cols-2 gap-4">
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
              <div>
                <label className="eyebrow text-xs block mb-1.5" style={{ color: "#7A9490" }}>
                  <Clock className="w-3 h-3 inline mr-1" />Heure de la prise
                </label>
                <input
                  type="time"
                  value={form.heure}
                  onChange={(e) => setForm((f) => ({ ...f, heure: e.target.value }))}
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
            </div>

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
          <div className="space-y-2">
            {sorties.length === 0 && (
              <p className="text-sm text-center py-10" style={{ color: "#7A9490" }}>
                Le carnet est vide. Enregistre ta première sortie.
              </p>
            )}
            {sorties
              .slice()
              .sort((a, b) => (a.date + a.heure < b.date + b.heure ? 1 : -1))
              .map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg p-4 flex items-center justify-between gap-3"
                  style={{ background: "#122B32", borderLeft: `3px solid ${coefColor(s.coefficient)}` }}
                >
                  {s.photoUrl && (
                    <button
                      type="button"
                      onClick={() => setLightbox(s.photoUrl)}
                      className="shrink-0 rounded-md overflow-hidden"
                      style={{ width: 56, height: 56 }}
                    >
                      <img src={s.photoUrl} alt="prise" className="w-full h-full object-cover" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="mono text-xs" style={{ color: "#7A9490" }}>{s.date} · {s.heure}</span>
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
                          <Fish className="w-3 h-3" /> {s.espece || "prise"}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: "#8C7355" }}>bredouille</span>
                      )}
                      {s.coefManuel && (
                        <span className="text-xs" style={{ color: "#5A6E6A" }}>(coef manuel)</span>
                      )}
                    </div>
                    {s.notes && <p className="text-sm truncate" style={{ color: "#C7D3D0" }}>{s.notes}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="mono text-lg font-semibold" style={{ color: coefColor(s.coefficient) }}>
                      {s.coefficient}
                    </span>
                    <button onClick={() => removeSortie(s.id)} aria-label="Supprimer">
                      <Trash2 className="w-4 h-4" style={{ color: "#5A6E6A" }} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
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
