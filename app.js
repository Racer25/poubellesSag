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

// Function to loop
let iteration = function () {

    console.log("/** Update of of garbage dates at "+ new Date().toISOString()+" **/");
    getRuesRequest(CONFIG.CivicNumber)
        .then(response => {
            let id = response.find((elem) => elem.value === CONFIG.Street).id;
            return getCollecteInfoRequest(id);
        })
        .then(response => {
            let typeRecyclage = "recyclage";
            let jourRecyclage = response.recyclage_jour;
            let typeVidange = "vidange";
            let jourVidange = response.poubelle_jour;

            let requestsCedule = [];
            requestsCedule.push
            (
                getCeduleRequest(jourRecyclage, typeRecyclage),
                getCeduleRequest(jourVidange, typeVidange)
            );

            return Promise.all(requestsCedule);
        })
        .then(jsonResponses => {
            // Récupération des dates
            let date_cueillette_recyclageString = jsonResponses[0].date_cueillette;
            let date_cueillette_vidangeString = jsonResponses[1].date_cueillette;
            let date_cueillette_recyclage = new Date(date_cueillette_recyclageString);
            let date_cueillette_vidange = new Date(date_cueillette_vidangeString);

            // MAJ dates
            date_cueillette_recyclage.setDate(date_cueillette_recyclage.getDate() - 1);
            date_cueillette_recyclage.setHours(14, 0, 0);
            let date_cueillette_recyclage_start = date_cueillette_recyclage;
            let date_cueillette_recyclage_end = new Date(date_cueillette_recyclage);
            date_cueillette_recyclage_end.setHours(15, 0, 0);
            console.log(date_cueillette_recyclage_start);
            console.log(date_cueillette_recyclage_end);

            date_cueillette_vidange.setDate(date_cueillette_vidange.getDate() - 1);
            date_cueillette_vidange.setHours(14, 0, 0);
            let date_cueillette_vidange_start = date_cueillette_vidange;
            let date_cueillette_vidange_end = new Date(date_cueillette_vidange);
            date_cueillette_vidange_end.setHours(15, 0, 0);
            console.log(date_cueillette_vidange_start);
            console.log(date_cueillette_vidange_end);


            // Insertion in calendar
            let paramsCheckRecyclage = {
                timeMin: date_cueillette_recyclage_start.toISOString(),
                timeMax: date_cueillette_recyclage_end.toISOString(),
                q: 'Poubelle',
                singleEvents: true,
                orderBy: 'startTime'
            };

            cal.Events.list(CONFIG.CalendarId, paramsCheckRecyclage)
                .then(json => {
                    //Success
                    console.log('List of events on calendar within time-range:');
                    console.log(json);
                    if (json.length === 0) {
                        let paramsInsertRecyclage = {
                            'start': {'dateTime': date_cueillette_recyclage_start},
                            'end': {'dateTime': date_cueillette_recyclage_end},
                            'location': 'Domicile',
                            'summary': 'Poubelle bleu!',
                            'status': 'tentative',
                            'description': 'SOOORT LAA',
                            'colorId': 1
                        };

                        cal.Events.insert(CONFIG.CalendarId, paramsInsertRecyclage)
                            .then(resp => {
                                console.log('inserted event:');
                                console.log(resp);
                            })
                            .catch(err => {
                                console.log('Error: insertEvent-' + err.message);
                            });
                    }
                }).catch(err => {
                //Error
                console.log('Error: listSingleEvents -' + err.message);
            });

            let paramsCheckVidange = {
                timeMin: date_cueillette_recyclage_start.toISOString(),
                timeMax: date_cueillette_recyclage_end.toISOString(),
                q: 'Poubelle',
                singleEvents: true,
                orderBy: 'startTime'
            };

            cal.Events.list(CONFIG.CalendarId, paramsCheckVidange)
                .then(json => {
                    //Success
                    console.log('List of events on calendar within time-range:');
                    console.log(json);
                    if (json.length === 0) {
                        let paramsInsertVidange = {
                            'start': {'dateTime': date_cueillette_vidange_start},
                            'end': {'dateTime': date_cueillette_vidange_end},
                            'location': 'Domicile',
                            'summary': 'Poubelle verte!',
                            'status': 'tentative',
                            'description': 'SOOORT LAA!!',
                            'colorId': 1
                        };

                        cal.Events.insert(CONFIG.CalendarId, paramsInsertVidange)
                            .then(resp => {
                                console.log('inserted event:');
                                console.log(resp);
                            })
                            .catch(err => {
                                console.log('Error: insertEvent-' + err.message);
                            });
                    }
                }).catch(err => {
                //Error
                console.log('Error: listSingleEvents -' + err.message);
            });
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