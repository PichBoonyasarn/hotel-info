const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

app.use('/api/config', require('./routes/config'));
app.use('/api/poi', require('./routes/poi'));
app.use('/api/routes', require('./routes/routePlanning'));
app.use('/api/static-map', require('./routes/staticMap'));
app.use('/api/document', require('./routes/documentGen'));

app.listen(PORT, () => {
  console.log(`Hotel Info running at http://localhost:${PORT}`);
});
