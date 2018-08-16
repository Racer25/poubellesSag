// Modules
const request = require("request");
const CalendarAPI = require('node-google-calendar');
let CronJob = require('cron').CronJob;

const CONFIG_CALENDAR = require('./calendarAPI/settings');
let cal = new CalendarAPI(CONFIG_CALENDAR);

//CONFIG file
const CONFIG = require('./config.json');

// Requests for https://ville.saguenay.ca/services-aux-citoyens/environnement/ordures-menageres/horaire-de-la-collecte
let getRuesRequest = function (civicNumber) {
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
let getCollecteInfoRequest = function (idBatiment) {
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
let getCeduleRequest = function (jour, type) {
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
let promiseCheckCalendar = function(date_cueillette_start, date_cueillette_end) {
        let paramsCheck = {
            timeMin: date_cueillette_start.toISOString(),
            timeMax: date_cueillette_end.toISOString(),
            q: 'Poubelle',
            singleEvents: true,
            orderBy: 'startTime'
        };

        return cal.Events.list(CONFIG.CalendarId, paramsCheck);
};
let promiseInsertCalendar = function(date_cueillette_start, date_cueillette_end, couleurPoubelle) {
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
let promiseGlobal =  new Promise((resolve, reject) =>
    {
        getRuesRequest(CONFIG.CivicNumber)
            .then(streetJson => {
                let id = streetJson.find((elem) => elem.value === CONFIG.Street).id;
                return getCollecteInfoRequest(id);
            })
            .then(resolve)
            .catch(reject)
    });

// Function to loop
let iteration = function () {

    console.log("\n/** Update of of garbage dates at "+ new Date().toISOString()+" **/");

    //Recyclage
    let date_cueillette_recyclage_start = new Date();
    let date_cueillette_recyclage_end = new Date();
    promiseGlobal
        .then(daysJson =>
        {
            let typeRecyclage = "recyclage";
            let jourRecyclage = daysJson.recyclage_jour;

            return getCeduleRequest(jourRecyclage, typeRecyclage);
        })
        .then(datesJson =>
        {
            // Récupération des dates
            let date_cueillette_recyclageString = datesJson.date_cueillette;
            let date_cueillette_recyclage = new Date(date_cueillette_recyclageString);

            // MAJ dates
            date_cueillette_recyclage.setDate(date_cueillette_recyclage.getDate() - 1);
            date_cueillette_recyclage.setHours(14, 0, 0);
            date_cueillette_recyclage_start = date_cueillette_recyclage;
            date_cueillette_recyclage_end = new Date(date_cueillette_recyclage);
            date_cueillette_recyclage_end.setHours(15, 0, 0);

            return promiseCheckCalendar(date_cueillette_recyclage_start, date_cueillette_recyclage_end);
        })
        .then(listEvents =>
        {
            if (listEvents.length === 0)
            {
                //Insertion
                console.log("Insertion of event recyclage at "+date_cueillette_recyclage_start.toISOString()+"...");
                return promiseInsertCalendar(date_cueillette_recyclage_start, date_cueillette_recyclage_end, "bleu");
            }
            else
            {
                console.log("Event recyclage already existing at "+date_cueillette_recyclage_start.toISOString()+", no insertion to do...");
                return false;
            }
        })
        .then((data) =>
        {
            if(data !== false)
            {
                console.log('Insertion of event recyclage  finished');
            }
        })
        .catch(error =>
        {
            console.error(error);
        });

    //Vidange
    let date_cueillette_vidange_start = new Date();
    let date_cueillette_vidange_end = new Date();
    promiseGlobal
        .then(daysJson =>
        {
            let typeVidange = "vidange";
            let jourVidange = daysJson.poubelle_jour;

            return getCeduleRequest(jourVidange, typeVidange);
        })
        .then(datesJson =>
        {
            // Récupération des dates
            let date_cueillette_vidangeString = datesJson.date_cueillette;
            let date_cueillette_vidange = new Date(date_cueillette_vidangeString);

            // MAJ dates
            date_cueillette_vidange.setDate(date_cueillette_vidange.getDate() - 1);
            date_cueillette_vidange.setHours(14, 0, 0);
            let date_cueillette_vidange_start = date_cueillette_vidange;
            let date_cueillette_vidange_end = new Date(date_cueillette_vidange);
            date_cueillette_vidange_end.setHours(15, 0, 0);

            return promiseCheckCalendar(date_cueillette_vidange_start, date_cueillette_vidange_end);
        })
        .then(listEvents =>
        {
            if (listEvents.length === 0)
            {
                //Insertion
                console.log("Insertion of event vidange at "+date_cueillette_vidange_start.toISOString()+"...");
                return promiseInsertCalendar(date_cueillette_vidange_start, date_cueillette_vidange_end, "verte");
            }
            else
            {
                console.log("Event vidange already existing at "+date_cueillette_vidange_start.toISOString()+", no insertion to do...");
                return false;
            }
        })
        .then((data) =>
        {
            if(data !== false)
            {
                console.log('Insertion of event vidange  finished');
            }
        })
        .catch(error =>
        {
            console.error(error);
        });
};

// Cronjob config
let task = new CronJob({
    cronTime: '01 * * * *',
    onTick: iteration,
    start: false,
    timeZone: 'America/Los_Angeles'
});

// Launch CronJob
task.start();