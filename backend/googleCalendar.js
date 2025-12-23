const fs = require('fs');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = 'token.json';

// Carica credenziali da credentials.json
function loadCredentials() {
  const content = fs.readFileSync('credentials.json');
  return JSON.parse(content);
}

function authorize(callback) {
  const credentials = loadCredentials();
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Prova a leggere token salvato
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
    callback(oAuth2Client);
  } else {
    console.log('⚠️ Nessun token. Apri questo URL nel browser per autorizzare:');
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    console.log(authUrl);
  }
}

// Salva token dopo il primo login
function saveTokenFromCode(code, res) {
  const credentials = loadCredentials();
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  oAuth2Client.getToken(code, (err, token) => {
    if (err) return res.status(400).send('Errore recupero token: ' + err);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
    console.log('✅ Token salvato in', TOKEN_PATH);
    res.send('Autorizzazione completata. Puoi chiudere questa finestra.');
  });
}

// Crea evento in agenda
function createEvent(eventData) {
  return new Promise((resolve, reject) => {
    authorize((auth) => {
      const calendar = google.calendar({ version: 'v3', auth });
      calendar.events.insert(
        {
          calendarId: 'primary', // puoi mettere un ID calendario specifico
          resource: eventData,
        },
        (err, event) => {
          if (err) return reject(err);
          resolve(event.data);
        }
      );
    });
  });
}

module.exports = { saveTokenFromCode, createEvent };
