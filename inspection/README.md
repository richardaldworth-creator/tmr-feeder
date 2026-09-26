# Inspection Notes

A phone app for recording a property inspection for valuation purposes. It is built for farms with several dwellings, a range of farm buildings and land, but works equally for a single house. Everything seen on the day is captured against the building, room or field it relates to, and exported for use in the office when writing the report.

## What it records

- **Record of inspection**: reference, property, client, purpose, basis of value, valuation date, inspection date and times on site, who inspected and who was present, weather and ground conditions, extent of inspection, limitations and areas not inspected, tenure and occupation as seen or stated, ESG and environmental observations, and general notes.
- **Dwellings** (H1, H2 and so on): type, age, construction, windows, heating and services, EPC and council tax band, occupancy, gardens and outbuildings, condition, defects and notes, with overall measurements for the gross internal area.
- **Rooms** within each dwelling: name, floor, dimensions, ceiling height, floor finish, features, condition and notes.
- **Farm buildings** (B1, B2 and so on): use, age, frame, walls, cladding, roof, floor, doors, services, eaves and ridge heights, capacity, current use, condition, defects and notes, with measurements.
- **Land parcels**: field number, area in hectares (acres shown), use, grade, topography, boundaries, water, access, and designations.
- **Site observations**: access, yard, services, boundaries, rights of way, flood risk, renewables, development potential and anything else.
- **Photographs** against any of the above, with captions and, if switched on, the GPS position. A Quick photo button captures to an unsorted tray for filing later.

Measurements are taken in metres. Each building or room can have several lines to deal with L-shaped or irregular plans, or a stated area can be entered directly, and areas are shown in m² and sq ft. Most fields offer a list of common entries but accept free text, and the phone's keyboard microphone can be used to dictate longer notes.

Each item has a **draft description** built from the notes, which updates as you type and gives a starting paragraph for the report.

## Exports

- **ZIP backup**: `inspection.json` with all notes, a `photos` folder with files named by building and room (for example `B3 Grain store 02 North elevation.jpg`), a CSV schedule of areas, and the Word inspection schedule. The ZIP can be imported back into the app on another device.
- **Word inspection schedule**: numbered sections for the inspection record, residential, farm buildings, land and site observations, with summary tables, measurement tables, a schedule of accommodation for each dwelling and the photographs two to a row with captions. It uses Arial 11pt on A4 with 1 inch margins, justified text and the house colour palette, and the numbering is handled by Word so paragraphs renumber if you add or delete one.
- **CSV schedule of areas** for Excel.

## Installing it on a phone

The app is a set of static files (`index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, the icons and the `lib` folder). It must be served over HTTPS for the camera, offline use and home screen installation to work properly. Options include:

1. GitHub Pages for this repository (Settings, Pages, deploy from branch). GitHub Pages on a private repository needs a paid GitHub plan.
2. Netlify or Cloudflare Pages, both of which have free tiers and accept a drag and drop of the `inspection` folder.

Once it is hosted, open the address on the phone once while in signal and then:

- **iPhone or iPad**: in Safari tap Share, then Add to Home Screen, and always open it from the home screen icon.
- **Android**: in Chrome tap the menu, then Install app or Add to Home screen.

After the first visit the app works with no signal, which matters on most farms.

## Points to be aware of

- **Data lives on the phone only** until you export it. Nothing is sent to a server. Export a ZIP after every inspection and save it to OneDrive, Dropbox or email it to the office. The home screen marks any inspection with unexported changes.
- **Safari's seven day rule**: Safari can delete data held by a website that has not been used for seven days. Apps added to the home screen are treated separately and are not expected to lose data in this way, which is why installing to the home screen is important on Apple devices.
- **Camera roll**: photographs taken with the in-app camera button are stored in the app, not in the phone's photo library. If you want copies in the library as well, take them with the normal camera app and use From library to bring them in.
- **Photograph size**: photographs are reduced to 2400 pixels on the long side by default to keep storage and the Word file manageable. This can be changed in Settings, including keeping the original file.
- **Red Book**: the record of inspection fields are laid out to help evidence the inspection and investigation requirements (VPS 4 in the 2025 edition of RICS Valuation, Global Standards), including date, extent, limitations and ESG matters. The app does not by itself make a valuation Red Book compliant, and the valuer's judgement on what to record remains the control.
