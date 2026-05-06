// Singleton holder for the shared Agenda instance.
// index.js creates the instance and calls setAgenda() immediately after start().
// Graceful shutdown reads it back via getAgenda().

let _agenda = null;

const setAgenda = (agenda) => { _agenda = agenda; };
const getAgenda = () => _agenda;

module.exports = { setAgenda, getAgenda };
