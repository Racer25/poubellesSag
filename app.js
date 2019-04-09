// Modules
const request = require("request");
const CalendarAPI = require('node-google-calendar');
let CronJob = require('cron').CronJob;
const nodemailer = require('nodemailer');

const CONFIG_CALENDAR = require('./calendarAPI/settings');
let cal;

//CONFIG file
const CONFIG = require('./config.json');

//Preparing mail objects
let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'charlescousyn@gmail.com',
        pass: CONFIG.GooglePassword
    }
});

/**
 * @return {boolean}
 */
let IsJsonString = function(str) {
    try
    {
        JSON.parse(str);
    } catch (e)
    {
        return false;
    }
    return true;
};

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
                    else if(!IsJsonString(body)) {
                        reject("It's not JSON!! :"+ body);
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
                    else if(!IsJsonString(body)) {
                        reject("It's not JSON!! :"+ body);
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
                    else if(!IsJsonString(body)) {
                        reject("It's not JSON!! :"+ body);
                    }
                    else {
                        resolve(JSON.parse(body));
                    }
                }
            );
    });
};

//Promises for calendar
let promiseCheckCalendar = function(CalendarId, date_cueillette_start, date_cueillette_end)
{
        let paramsCheck = {
            timeMin: date_cueillette_start.toISOString(),
            timeMax: date_cueillette_end.toISOString(),
            q: 'Poubelle',
            singleEvents: true,
            orderBy: 'startTime'
        };

        return cal.Events.list(CalendarId, paramsCheck);
};
let promiseInsertCalendar = function(CalendarId, date_cueillette_start, date_cueillette_end, couleurPoubelle)
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

    return cal.Events.insert(CalendarId, paramsInsert);
};

//Promise to send mails
let promiseSendMail = function(mailOptions)
{
    return new Promise((resolve, reject) =>
    {
        transporter.sendMail(mailOptions,
            function (err, info)
            {
                if (err)
                {
                    reject(err)
                }
                else
                {
                    resolve(info);
                }
            }
        )});
};

//Promise with tasks in common
let promiseGlobal = function()
{
    let adresses = CONFIG.Adresses;

    let promisesGetRueRequest = adresses.map(adress =>
        getRuesRequest(adress.CivicNumber)
                .then(streetJson =>
                {
                    let id = streetJson.find((elem) => elem.value === adress.Street).id;
                    return Promise.all([getCollecteInfoRequest(id), adress]);
                }));

    return Promise.all(promisesGetRueRequest);
};

//Workflow for one type of garbage
let WorkFlowOneTypeOfGarbage = function(type, attributeToUse, couleurPoubelle)
{
    promiseGlobal()
        .then(daysJsonTab =>
        {
            let promisesGetCeduleRequest = daysJsonTab.map(daysJson =>
            {
                let jour = daysJson[0][attributeToUse+"_jour"];

                return Promise.all([getCeduleRequest(jour, type), daysJson[1]]);
            });

            return Promise.all(promisesGetCeduleRequest);
        })
        .then(datesJsonTab =>
        {
            let promises = datesJsonTab.map(datesJson =>
            {
                // Récupération des dates
                let date_cueillette_String = datesJson[0].date_cueillette;
                let date_cueillette = new Date(date_cueillette_String);

                // MAJ dates
                date_cueillette.setDate(date_cueillette.getDate() - 1);
                date_cueillette.setHours(14, 0, 0);
                let date_cueillette_start = date_cueillette;
                let date_cueillette_end = new Date(date_cueillette);
                date_cueillette_end.setHours(15, 0, 0);

                let adress = datesJson[1];
                if(adress.MailNotCalendar)
                {
                    let dateNow = new Date();

                    //Si on est la veille du passage et qu'il est entre 14h et 15h
                    if(dateNow.getFullYear() === date_cueillette.getFullYear() &&
                        dateNow.getMonth() === date_cueillette.getMonth() &&
                        dateNow.getDate() === date_cueillette.getDate() &&
                        dateNow.getHours() > 14 && dateNow.getHours() < 15)
                    {
                        //Envoyer mail

                        //Init html of the mail
                        let myHtml="<div><p>Il faut sortir la poubelle "+couleurPoubelle+" !!</p></div>";

                        let mailOptions = {
                            from: 'charlescousyn@gmail.com', // sender address
                            to: adress.Mail, // list of receivers
                            subject: 'Passage de la poubelle '+couleurPoubelle+" demain", // Subject line
                            html: myHtml
                        };

                        promiseSendMail(mailOptions)
                            .then(console.log)
                            .catch(console.error);
                    }
                }
                else
                {
                    //Exécution du Calendrier
                    return Promise.all([promiseCheckCalendar(adress.CalendarId, date_cueillette_start, date_cueillette_end), date_cueillette_start, date_cueillette_end])
                        .then(([listEvents, date_cueillette_start, date_cueillette_end])=>
                        {
                            if (listEvents.length === 0)
                            {
                                //Insertion
                                console.log("Insertion of event "+type+" at "+date_cueillette_start.toISOString()+"...");
                                return promiseInsertCalendar(adress.CalendarId, date_cueillette_start, date_cueillette_end, couleurPoubelle);
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
                }

            });
            return Promise.all(promises);
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
        cronTime: '01 * * * *',
        onTick: iteration,
        start: false,
        timeZone: 'America/Los_Angeles'
    } );

// Launch CronJob
task.start();