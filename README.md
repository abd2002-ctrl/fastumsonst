# FastUmsonst – Beta 0.1

Web-App (PWA), die man wie eine App auf den Startbildschirm legen kann.

## Was drin ist

| Datei | Wofür |
|---|---|
| `index.html` | Die komplette App (Design + Funktionen) |
| `api/stations.js` | Server-Funktion, die echte Spritpreise von Tankerkönig holt |
| `manifest.webmanifest`, `sw.js`, `icons/` | Damit man die App auf dem Handy installieren kann |
| `app.html` | Quelldatei für `index.html` (nur zum Bearbeiten, wird nicht gebraucht) |

## In 4 Schritten online bringen

### 1. Tankerkönig-Schlüssel holen (kostenlos)
- Auf **creativecommons.tankerkoenig.de** registrieren.
- Du bekommst einen API-Schlüssel per E-Mail.

### 2. Kostenloses Konto bei Vercel anlegen
- Auf **vercel.com** mit E-Mail oder GitHub registrieren (Hobby-Plan, kostenlos).

### 3. App hochladen
Am einfachsten über GitHub:
1. Auf **github.com** ein Konto anlegen und ein neues Repository „fastumsonst“ erstellen.
2. Alle Dateien aus diesem Ordner hochladen („Add file“ → „Upload files“).
3. In Vercel auf **„Add New… → Project“** klicken und das Repository importieren.
4. Vor dem Klick auf „Deploy“ unter **Environment Variables** eintragen:
   - Name: `TANKERKOENIG_KEY`
   - Wert: dein Schlüssel aus Schritt 1
5. **Deploy** klicken. Nach ca. einer Minute bekommst du einen Link wie `fastumsonst.vercel.app`.

### 4. Aufs Handy
- Link im Handy öffnen, Standort erlauben.
- **iPhone:** Safari → Teilen → „Zum Home-Bildschirm“.
- **Android:** Chrome → Menü (drei Punkte) → „App installieren“.

## Vor dem öffentlichen Start erledigen
- In `index.html` (und `app.html`) die Zeile `const FEEDBACK_EMAIL = ...` auf deine echte Adresse ändern.
- **Impressum** und **Datenschutzerklärung** ergänzen (Pflicht in Deutschland, sobald die Seite öffentlich ist).
- Eigene Domain (z. B. fastumsonst.de) in Vercel unter „Domains“ verbinden.

## Wie die App rechnet
- **Tank:** Füllstand minus (gefahrene km × Verbrauch). Ohne GPS schätzt die App die km aus dem Fahrprofil (km pro Woche). Mit jedem eingetragenen Kilometerstand passt sie km/Woche und Verbrauch an.
- **Gespart:** (Durchschnittspreis der Tankstellen in der Nähe − bezahlter Preis) × Liter. Bei der Wunschliste: Preis beim Eintragen − Kaufpreis.
- **Beste Zeit:** Faustregel, dass Sprit am frühen Abend meist am günstigsten ist.
- Alle Daten bleiben auf dem Handy der Nutzer (localStorage), es gibt noch kein Benutzerkonto.

Datenquelle Spritpreise: Markttransparenzstelle für Kraftstoffe (MTS-K) über Tankerkönig.de, Lizenz CC BY 4.0.
