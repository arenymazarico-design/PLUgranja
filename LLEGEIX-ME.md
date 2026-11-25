# PLUgranja – Posada en marxa a Netlify

## 1. Pujar el projecte
Aquesta app té servidor (Netlify Functions + Netlify Blobs), per tant **no serveix arrossegar la carpeta a Netlify Drop**. Fes-ho d'una d'aquestes maneres:

**A) Amb GitHub (recomanat):** puja aquesta carpeta a un repositori → Netlify → *Add new site → Import from Git*. Netlify llegeix `netlify.toml` sol.

**B) Amb Netlify CLI des del PC:**
```
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```

## 2. Variables d'entorn (Site configuration → Environment variables)
| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | La teva clau d'API d'Anthropic (console.anthropic.com) |
| `APP_SECRET` | Una frase llarga i aleatòria qualsevol (signa les sessions) |
| `ANTHROPIC_MODEL` | *(opcional)* per defecte `claude-haiku-5-5` |

Després de posar-les, torna a desplegar (*Deploys → Trigger deploy*).

## 3. Primer accés
- Usuari: `admin` · PIN: `1234` → **canvia'l de seguida** (botó PIN).
- Crea les granges a **Granges** (naus, contenidors d'hidròlisi, pròpia/no pròpia).
- Crea els usuaris a **Configuració** i assigna granges als grangers.

## 4. Instal·lar al mòbil
Obre l'adreça a Safari (iPhone) → Compartir → *Afegir a pantalla d'inici*. A Android, Chrome → *Instal·lar aplicació*.

## Estructura
- `public/` – app (index.html, logo, icones)
- `netlify/functions/api.mjs` – servidor: usuaris, permisos, dades, fotos d'albarans i lectura amb IA
