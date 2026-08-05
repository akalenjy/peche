-- À exécuter une fois dans Supabase : Dashboard > SQL Editor > New query > coller > Run

create table sorties (
  id uuid primary key default gen_random_uuid(),
  prenom text not null,
  point text,
  point_label text,
  date date not null,
  heure time not null,
  heure_fin time,
  coefficient int not null,
  hauteur numeric,
  coef_manuel boolean default false,
  direction text, -- 'montante' | 'descendante' | null
  photo_url text,
  prise boolean not null,
  nb_poissons int default 0,
  espece text,
  notes text,
  created_at timestamptz default now()
);

-- Sécurité : seuls les utilisateurs connectés (comptes créés pour les 3 frères
-- dans Authentication > Users) peuvent lire/écrire. La clé "anon" reste dans le
-- code de l'app (c'est normal et prévu pour Supabase), mais elle ne suffit plus
-- à elle seule : il faut être connecté.
alter table sorties enable row level security;

create policy "authenticated users only"
  on sorties
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Pour activer la synchronisation en direct entre les 3 frères (déjà utilisée
-- par l'app via supabase.channel(...)) :
alter publication supabase_realtime add table sorties;

-- Stockage des photos de prises : crée un bucket public "photos" (lecture
-- publique, mais seuls les utilisateurs connectés peuvent en envoyer).
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy "authenticated can upload photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'photos');

create policy "anyone can view photos"
  on storage.objects for select
  using (bucket_id = 'photos');

create policy "authenticated can delete photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'photos');

-- ⤵ Si la table "sorties" existe déjà (installation faite avant l'ajout des
-- photos et de la direction de marée), lance plutôt ces deux lignes seules :
-- alter table sorties add column if not exists direction text;
-- alter table sorties add column if not exists photo_url text;

-- ⤵ Si la table "sorties" existe déjà (installation faite avant l'ajout de
-- l'heure de fin et du nombre de poissons), lance plutôt ces deux lignes seules :
-- alter table sorties add column if not exists heure_fin time;
-- alter table sorties add column if not exists nb_poissons int default 0;
