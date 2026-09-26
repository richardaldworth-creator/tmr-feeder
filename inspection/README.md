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

Measurements are taken in metres. Each building or room can have several lines to deal with L-shaped or irregular plans, or a stated area can be entered directly, and areas are shown in m² and sq ft. Most fields offer a list of common entries but accept free text.

Each item has a **draft description** built from the notes, which updates as you type and gives a starting paragraph for the report.

## Dictation and voice notes

- **Microphone beside every field.** Tap it, speak, and tap again to stop. Short fields are replaced by what you say, and the notes boxes are added to. Say "full stop", "comma", "question mark", "colon", "new line" or "new paragraph" for punctuation. Numbers such as "six point one" become 6.1, and "24 by 18" becomes 24 x 18.
- **Dictate notes button** at the top of each building, room and dwelling, so you can describe the whole item in one go. Any measurements you say, such as "main span 24.4 by 18.3, lean-to 12 by 6, eaves 6.1", are offered for the measurements table and are only added if you tap Add. A Pick up measurements from notes button does the same later.
- **Voice notes.** Record audio against any item, or as general notes for the inspection. Recordings work with no signal, play back in the app, go into the ZIP in an `audio` folder, and can have a transcript typed or dictated later, which then appears in the Word schedule.

How well the in-app microphone works depends on the phone:

- **Android (Chrome):** it needs a signal unless the offline UK English speech pack is installed. Settings has a button to check for the pack and download it, which should be done on wifi before going out.
- **iPhone:** the in-app microphone uses Apple's online service and is unreliable in home screen apps. The microphone key on the iPhone keyboard runs on the phone for UK English and works with no signal, so choose "Keyboard microphone only" in Settings if the in-app button fails.
- **Voice notes** record on either platform with no signal. They are not transcribed automatically, because browsers can only transcribe live speech.

## Exports

- **ZIP backup**: `inspection.json` with all notes, an `audio` folder of voice notes, a `photos` folder with files named by building and room (for example `B3 Grain store 02 North elevation.jpg`), a CSV schedule of areas, and the Word inspection schedule. The ZIP can be imported back into the app on another device.
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
- **Phone gallery**: a web app is not allowed to write to the phone's photo library by itself, so saving to the gallery always takes a tap. After each in-app photograph the app offers to save a copy, and each building and the Export section have a Save to phone gallery button that sends any photographs not yet saved, twenty at a time. On an iPhone this opens the Share sheet, where you tap Save Images. On Android the photographs are saved to the Download folder, which gallery apps show as a Download album. Google Photos only shows it under Photos on device unless backup is switched on for that folder. Photographs brought in with From library are already in the gallery and are not saved twice. Saved copies, and the photographs in the ZIP, carry the date and time taken, the GPS position and the caption, so they sort and map correctly. If you want the full resolution original in the gallery as well, take the photograph with the phone's own camera and bring it in with From library.
- **Photograph size**: photographs are reduced to 2400 pixels on the long side by default to keep storage and the Word file manageable. This can be changed in Settings, including keeping the original file.
- **Red Book**: the record of inspection fields are laid out to help evidence the inspection and investigation requirements (VPS 4 in the 2025 edition of RICS Valuation, Global Standards), including date, extent, limitations and ESG matters. The app does not by itself make a valuation Red Book compliant, and the valuer's judgement on what to record remains the control.
