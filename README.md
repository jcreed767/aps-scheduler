# Call Center Scheduler

Inbound call center scheduling app for a 14-person Site Manager team. Built for a 5-days-on/2-days-off rotation with Erlang C-backed shift targets.

## Features

- **Schedule Grid**: Visual grid (dates × managers) with click-to-edit cells
- **Coverage Analysis**: Automated gap detection with peak/high-demand day flagging
- **Manager Summary**: Per-manager shift breakdown and day-off totals
- **Forecast Upload**: Upload updated Excel call volume files
- **Hourly Distribution**: Visual bar chart of intraday call patterns
- **Export to Excel**: Full schedule + summary + gap report in one file

## Shift Structure

| Shift | Hours (EST) |
|-------|-------------|
| A     | 8am – 4pm   |
| B     | 12pm – 8pm  |
| C     | 2pm – 10pm  |

**Default daily target**: 7A / 2B / 1C  
**Peak days (Jul 1, Jul 31)**: 9A / 0B / 1C

## Running Locally

```bash
npm install
npm start
```

## Deploying to Netlify via GitHub

1. Push this folder to a new GitHub repository
2. Log in to [Netlify](https://netlify.com)
3. Click **Add new site → Import an existing project**
4. Connect your GitHub account and select the repo
5. Netlify auto-detects the build settings from `netlify.toml`
6. Click **Deploy site**

Every push to the `main` branch auto-deploys.

## Customization

- **Add/rename managers**: Settings tab → Manager Roster
- **Set shift anchors**: Settings tab → Shift Anchor dropdown per manager
- **Change date range**: Settings tab → Schedule Period
- **Update forecast**: Forecast & Data tab → Upload new Excel file
