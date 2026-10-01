# Energy Flow House Card

Een Lovelace-kaart voor Home Assistant die de energiestromen van je huis geanimeerd over een **eigen afbeelding van je huis** tekent: zonnepanelen, thuisbatterij (met SOC-indicator), stroomnet, verbruik en het weer.

- 🖼️ Kies zelf de afbeelding en zet hem op de gewenste positie en grootte
- ✥ Sleep labels, het weer en de batterij-indicator naar de juiste plek
- ✎ **Teken je eigen stroomlijnen** door op de kaart te klikken
- ⚡ De animatie loopt in de richting van de stroom (afname ↔ teruglevering, laden ↔ ontladen) en stopt als er niets loopt
- 🏎️ De snelheid hangt af van het vermogen
- 🔋 De batterij-indicator kleurt mee met het laadniveau (rood, oranje, groen) en pulseert tijdens het laden

## Installatie via HACS

1. Zet deze map in een (eigen) GitHub-repository, bijvoorbeeld `energy-flow-house-card`.
2. Ga in HACS naar **⋮ → Aangepaste repositories**, voeg de URL van je repository toe en kies het type **Dashboard**.
3. Installeer **Energy Flow House Card** en ververs je browser.

### Handmatig

Kopieer `dist/energy-flow-house-card.js` naar `/config/www/` en voeg bij **Instellingen → Dashboards → ⋮ → Bronnen** de bron `/local/energy-flow-house-card.js` toe (type: JavaScript-module).

## Afbeelding

Zet de afbeelding van je huis bijvoorbeeld in `/config/www/huis.png` en gebruik `/local/huis.png` als URL. Een PNG met een transparante of donkere achtergrond werkt het mooist. Klik daarna in de ontwerper op **Afbeelding passend maken**, dan krijgt de kaart dezelfde verhouding als de afbeelding.

## Gebruik van de visuele editor

Voeg de kaart toe via **Kaart toevoegen → Energy Flow House Card**. Bovenaan de editor staat de **Ontwerper**:

| Modus | Wat je doet |
|---|---|
| **Verplaatsen** | Sleep de afbeelding, de labels, het weer en de batterij-indicator. Met het blauwe hoekje pas je de grootte van de afbeelding of de batterij-indicator aan. |
| **Lijnen tekenen** | Kies een stroom (Zon, Net, Batterij of Verbruik) en klik op de kaart om punten toe te voegen. Sleep een punt om het te verplaatsen, dubbelklik of rechtsklik om het te verwijderen. Houd **Shift** ingedrukt voor rechte lijnen. Met **Extra lijn** teken je statische lijnen, bijvoorbeeld de dunne lijnen van een label naar een onderdeel van het huis. |

**Tekenrichting:** begin altijd bij de **bron** (het groene punt): het paneel, de aansluiting op het net of de batterij. Teken van daaruit naar de meterkast of het huis. Bij een positieve waarde loopt de animatie in de tekenrichting, bij een negatieve waarde andersom. Met **Richting omdraaien** draai je een getekende lijn om.

## Tekenconventies van de sensoren

| Sensor | Positief | Negatief |
|---|---|---|
| `grid` | afname van het net → animatie naar het huis | teruglevering → animatie naar het net |
| `battery` | ontladen → animatie naar het huis | laden → animatie naar de batterij |
| `solar` | opwek → animatie naar het huis | – (animatie stopt) |
| `home` | verbruik | – |

Gebruikt jouw integratie het omgekeerde teken? Zet dan **Batterij omkeren** of **Net omkeren** aan. Geen sensor voor het verbruik? Laat `home` leeg, dan berekent de kaart het verbruik als zon + net + batterij. W, kW en MW worden automatisch omgerekend.

## Voorbeeld-YAML

```yaml
type: custom:energy-flow-house-card
image: /local/huis.png
aspect_ratio: 0.923
entities:
  solar: sensor.solar_power
  home: sensor.house_consumption
  battery: sensor.battery_power
  battery_soc: sensor.battery_soc
  grid: sensor.grid_power
  weather: weather.forecast_home
invert:
  battery: false
  grid: false
positions:            # alles in % van de kaart (x vanaf links, y vanaf boven, middelpunt)
  weather: { x: 17, y: 5.5 }
  solar:   { x: 31, y: 17.5 }
  home:    { x: 80, y: 17.5 }
  battery: { x: 30, y: 91 }
  grid:    { x: 77, y: 91 }
battery_indicator:
  show: true
  x: 35.2
  y: 79.5
  width: 3.2
  height: 9
  orientation: vertical   # of horizontal
  show_text: false
flows:                 # punten in %, van bron naar huis
  solar:   { points: [[55, 58], [55, 66]], color: "#ffd23f" }
  battery: { points: [[37, 72.6], [53, 72.6]], color: "#ffd23f" }
  home:    { points: [[57, 67.6], [72, 67.6]], color: "#ffd23f" }
  grid:    { points: [[75, 80], [55, 75.5], [55, 72]], color: "#ffd23f" }
lines:                 # statische lijnen (decoratie)
  - points: [[31, 22], [31, 62]]
    color: "rgba(255,255,255,0.35)"
    width: 0.25
```

## Alle opties

| Optie | Standaard | Omschrijving |
|---|---|---|
| `image` | – | URL van de afbeelding van het huis |
| `aspect_ratio` | `0.923` | Verhouding breedte/hoogte van de kaart |
| `image_position` | `{x:0,y:0,width:100}` | Positie en breedte van de afbeelding in % |
| `background` | kaartachtergrond | CSS-achtergrond van de kaart |
| `text_color` / `secondary_text_color` | themakleuren | Tekstkleuren |
| `font_scale` | `1` | Schaalfactor voor alle tekst (schaalt ook mee met de kaartbreedte) |
| `names` | NL-namen | `solar`, `home`, `battery`, `grid` |
| `texts` | NL | `import`, `export`, `charging`, `discharging` |
| `show_direction` | `true` | Toon "afname", "laden", enzovoort achter de naam |
| `calculate_home` | `true` | Bereken het verbruik als `home` niet is ingesteld |
| `entities.temperature` | – | Aparte temperatuursensor (overschrijft de weer-entiteit) |
| `min_power` | `10` | Onder dit vermogen (W) stopt de animatie |
| `max_power` | `5000` | Bij dit vermogen (W) loopt de animatie op maximale snelheid |
| `speed` | `12` | Basissnelheid van de animatie |
| `dash` / `gap` | `4` / `9` | Lengte van de streepjes en de ruimte ertussen (% van de breedte) |
| `line_width` | `0.55` | Lijndikte (% van de breedte), per stroom te overschrijven met `width` |
| `line_color` | `rgba(255,255,255,0.35)` | Kleur van een lijn zonder stroom |
| `corner_radius` | `1.5` | Afronding van de hoeken in de lijnen |
| `flows.<x>.reverse` | `false` | Keer de animatierichting van één stroom om |
| `flows.<x>.dash` / `gap` / `color` / `width` | – | Instellingen per stroom |

Klik op een label om het meer-info-venster van de entiteit te openen.
