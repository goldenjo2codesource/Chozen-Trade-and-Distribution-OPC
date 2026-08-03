# Chozen Resources Inc. System

Simple job agency website with public pages, job listings, login/register, and an application form.

## Pages

- `index.html` - Home page
- `jobs.html` - Job listing and Apply buttons
- `login.html` - Applicant login
- `register.html` - Create applicant account
- `apply.html` - Application form

## Backend and Frontend

This project now includes a simple Node.js backend in `server.js`.
The server serves the static files and provides REST API routes for jobs, registration, login, and applications.

### Data persistence

Stored in JSON files under `data/`:

- `data/jobs.json` - job listings
- `data/users.json` - registered users
- `data/applications.json` - submitted applications

## How to Run

1. Install Node.js if not already installed.
2. Open PowerShell and change directory to the project root:

```powershell
cd "c:\Users\Admin\Chozen Resources Inc. System"
```

3. Start the server:

```powershell
node server.js
```

4. Open the site in a browser:

```text
http://localhost:3000
```

If you do not have Node installed, you can also use the VS Code Live Server extension for static preview, but the API endpoints require Node.

## API Endpoints

- `GET /api/jobs` - returns job listings
- `POST /api/register` - register a new applicant
- `POST /api/login` - login with email and password
- `POST /api/apply` - submit an application

## Best Order Para Aralin

1. Open `index.html`.
2. Study `styles.css` for the design.
3. Review `server.js` for the backend endpoints.
4. Review `app.js` for the client-side fetch logic and form handling.
5. Inspect the `data/` JSON files for persisted data.

## Notes

- Login and application actions now call the backend API instead of storing everything only in browser `localStorage`.
- The app is still simple and easy to edit while keeping the frontend and backend connected.
