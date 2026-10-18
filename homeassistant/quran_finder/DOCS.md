# Quran Whisperer

Open the web app on any phone or computer on your network:

**https://homeassistant.local:3001** (or `https://<home-assistant-ip>:3001`)

The first visit from each device shows a certificate warning, because the add-on
makes its own certificate. Accept it once (*Advanced → Proceed* in Chrome,
*Show Details → visit this website* in Safari). Browsers only allow the
microphone on https pages, so plain http won't work.

## A button on your dashboard

Edit a dashboard → **Add card** → **Manual**, and paste:

```yaml
type: button
name: Quran Whisperer
icon: mdi:book-open-variant
tap_action:
  action: url
  url_path: https://homeassistant.local:3001
```

Android phones often can't open `.local` names; if the button doesn't load,
use Home Assistant's IP instead (e.g. `https://192.168.1.179:3001`).

It opens the app in the browser rather than inside Home Assistant: Home
Assistant is served over plain http, and a page shown inside it can't use the
microphone.

## Notes

- The first time it's used, the add-on downloads the speech model (~400 MB)
  into its data folder. After that it starts in a few seconds.
- Recognition runs on Home Assistant's CPU: about 1.3 s per check on 2 cores.
  **Listen** follows the reciter once it finds your place, with a check every
  2–5 seconds, so it keeps those cores busy for as long as it's on. Turn
  *follow the reciter* off in the settings, and it stops listening once it has
  found the place. Once loaded, the speech model takes about 1.3 GB of RAM,
  so give the VM at least 1.5 GB more than Home Assistant already uses.
- Reading the translation aloud uses the voices of the phone or computer the
  page is open on, not the add-on.
- In a Proxmox VM, set the CPU type to `host` for full speed (the default type
  hides newer instructions like AVX2).
- Port 3001 must be free on the Home Assistant host. It's 3001 rather than 3000
  so it can run beside the Sound Finder add-on.
