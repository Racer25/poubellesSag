// Modules
const request = require("request");
const CalendarAPI = require('node-google-calendar');
let CronJob = require('cron').CronJob;

const CONFIG_CALENDAR = require('./calendarAPI/settings');
let cal;

//CONFIG file
const CONFIG = require('./config.json');

// Requests for https://ville.saguenay.ca/services-aux-citoyens/environnement/ordures-menageres/horaire-de-la-collecte
let getRuesRequest = function (civicNumber)
{
    return new Promise((resolve, reject) => {
        request
            .post(
                'https://ville.saguenay.ca/ajax/collectes/getrues',
                {form: {no_civique: civicNumber}},
                function (err, httpResponse, body) {
                    if (err) {
                        console.error(err);
                        console.error(httpResponse);
                        reject(err);
                    }
                    else {
                        resolve(JSON.parse(body));
                    }
                }
            );
    });
};
let getCollecteInfoRequest = function (idBatiment)
{
    return new Promise((resolve, reject) => {
        request
            .post(
                'https://ville.saguenay.ca/ajax/collectes/getcollecteinfo',
                {form: {cle_batiment: idBatiment}},
                function (err, httpResponse, body) {
                    if (err) {
                        console.error(err);
                        console.error(httpResponse);
                        reject(err);
                    }
                    else {
                        resolve(JSON.parse(body));
                    }
                }
            );
    });
};
let getCeduleRequest = function (jour, type)
{
    return new Promise((resolve, reject) => {
        request
            .post(
                'https://ville.saguenay.ca/ajax/collectes/getcedule',
                {form: {jour: jour, type: type}},
                function (err, httpResponse, body) {
                    if (err) {
                        console.error(err);
                        console.error(httpResponse);
                        reject(err);
                    }
                    else {
                        resolve(JSON.parse(body));
                    }
                }
            );
    });
};

//Promises for calendar
let promiseCheckCalendar = function(date_cueillette_start, date_cueillette_end)
{
        let paramsCheck = {
            timeMin: date_cueillette_start.toISOString(),
            timeMax: date_cueillette_end.toISOString(),
            q: 'Poubelle',
            singleEvents: true,
            orderBy: 'startTime'
        };

        return cal.Events.list(CONFIG.CalendarId, paramsCheck);
};
let promiseInsertCalendar = function(date_cueillette_start, date_cueillette_end, couleurPoubelle)
{
    let paramsInsert = {
        'start': {'dateTime': date_cueillette_start},
        'end': {'dateTime': date_cueillette_end},
        'location': 'Domicile',
        'summary': 'Poubelle '+couleurPoubelle+"!",
        'status': 'tentative',
        'description': 'SOOORT LAA',
        'colorId': 1
    };

    return cal.Events.insert(CONFIG.CalendarId, paramsInsert);
};

//Promise with tasks in common
let promiseGlobal =function()
{
    return getRuesRequest(CONFIG.CivicNumber)
        .then(streetJson => {
            let id = streetJson.find((elem) => elem.value === CONFIG.Street).id;
            return getCollecteInfoRequest(id);
        });
};

//Workflow for one type of garbage
let WorkFlowOneTypeOfGarbage = function(type, attributeToUse, couleurPoubelle)
{
    promiseGlobal()
        .then(daysJson =>
        {
            let jour = daysJson[attributeToUse+"_jour"];

            return getCeduleRequest(jour, type);
        })
        .then(datesJson =>
        {
            // Récupération des dates
            let date_cueillette_String = datesJson.date_cueillette;
            let date_cueillette = new Date(date_cueillette_String);

            // MAJ dates
            date_cueillette.setDate(date_cueillette.getDate() - 1);
            date_cueillette.setHours(14, 0, 0);
            let date_cueillette_start = date_cueillette;
            let date_cueillette_end = new Date(date_cueillette);
            date_cueillette_end.setHours(15, 0, 0);

            return Promise.all([promiseCheckCalendar(date_cueillette_start, date_cueillette_end), date_cueillette_start, date_cueillette_end]);
        })
        .then(([listEvents, date_cueillette_start, date_cueillette_end])=>
        {
            if (listEvents.length === 0)
            {
                //Insertion
                console.log("Insertion of event "+type+" at "+date_cueillette_start.toISOString()+"...");
                return promiseInsertCalendar(date_cueillette_start, date_cueillette_end, couleurPoubelle);
            }
            else
            {
                console.log("Event "+type+" already existing at "+date_cueillette_start.toISOString()+", no insertion to do...");
                return false;
            }
        })
        .then((data) =>
        {
            if(data !== false)
            {
                console.log("Insertion of event "+type+"  finished");
            }
        })
        .catch(error =>
        {
            console.error(error);
        });
};

// Function to loop
let iteration = function ()
{
    console.log("\n/** Update of of garbage dates at "+ new Date().toISOString()+" **/");
    //Init calendar
    cal = new CalendarAPI(CONFIG_CALENDAR);

    WorkFlowOneTypeOfGarbage("recyclage", "recyclage", "bleu");
    WorkFlowOneTypeOfGarbage("vidange", "poubelle", "verte");
};

// Cronjob config
let task = new CronJob(
    {
        cronTime: '* * * * *',
        onTick: iteration,
        start: false,
        timeZone: 'America/Los_Angeles'
    } );

// Launch CronJob
task.start();