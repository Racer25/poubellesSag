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
                        console.error("getRuesRequest");
                        console.error(body);
                        reject("It's not JSON!!");
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
                {form: {ide: idBatiment}},
                function (err, httpResponse, body) {
                    if (err) {
                        console.error(err);
                        console.error(httpResponse);
                        reject(err);
                    }
                    else if(!IsJsonString(body)) {
                        console.error("getCollecteInfoRequest");
                        console.error(body);
                        reject("It's not JSON!! :"+ body);
                    }
                    else {
                        resolve(JSON.parse(body));
                    }
                }
            );
    });
};
let getCeduleRequest = function (horaire_id)
{
    return new Promise((resolve, reject) => {
        request
            .post(
                'https://ville.saguenay.ca/ajax/collectes/getcedule',
                {form: {horaire_id: horaire_id}},
                function (err, httpResponse, body) {
                    if (err) {
                        console.error(err);
                        console.error(httpResponse);
                        reject(err);
                    }
                    else if(!IsJsonString(body)) {
                        console.error("getCeduleRequest");
                        console.error(body);
                        reject("It's not JSON!!");
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
let WorkFlowOneTypeOfGarbage = function()
{
    promiseGlobal()
        .then(collecteInfosAndAddresses =>
        {

            let promisesGetCeduleRequest = collecteInfosAndAddresses.map(collecteInfoAndAddress =>
            {
                let arrayOfGetCedulePromises = [];
                for(let i = 0; i < collecteInfoAndAddress[0].length; i++)
                {
                    arrayOfGetCedulePromises.push(getCeduleRequest(collecteInfoAndAddress[0][i].horaire_id));
                }

                return Promise.all(
                    [
                        Promise.all(arrayOfGetCedulePromises),
                        collecteInfoAndAddress
                    ]);
            });

            return Promise.all(promisesGetCeduleRequest);
        })
        .then(datesJsonTab =>
        {
            let promises = datesJsonTab.map(datesJsonOneHome =>
            {

                // Récupération des dates
                return Promise.all(datesJsonOneHome[0].map((horaireInfo, index, tab) =>
                {
                    let date_collecte_String = horaireInfo.date_collecte;
                    let date_collecte = new Date(date_collecte_String);

                    // MAJ dates
                    date_collecte.setDate(date_collecte.getDate());
                    date_collecte.setHours(14, 0, 0);
                    let date_collecte_start = date_collecte;
                    let date_collecte_end = new Date(date_collecte);
                    date_collecte_end.setHours(15, 0, 0);

                    let adress = datesJsonOneHome[1][1];

                    //Trouver couleur poubelle
                    let couleurPoubelle = "rouge";
                    if(datesJsonOneHome[1][0][index].acronyme === "REC")
                    {
                        couleurPoubelle = "bleue";
                    }
                    else if(datesJsonOneHome[1][0][index].acronyme === "ORD")
                    {
                        couleurPoubelle = "verte";
                    }
                    else if(datesJsonOneHome[1][0][index].acronyme === "RES")
                    {
                        couleurPoubelle = " de résidus verts";
                    }


                    if(adress.MailNotCalendar)
                    {
                        let dateNow = new Date();

                        //Si on est la veille du passage et qu'il est entre 14h et 15h
                        if(dateNow.getFullYear() === date_collecte.getFullYear() &&
                            dateNow.getMonth() === date_collecte.getMonth() &&
                            dateNow.getDate() === date_collecte.getDate() &&
                            dateNow.getHours() > 14 && dateNow.getHours() < 15)
                        {
                            //Envoyer mail
                            //Init html of the mail
                            let myHtml="<div><p>Il faut sortir la poubelle "+couleurPoubelle+" aujourd'hui!!</p></div>";

                            let mailOptions = {
                                from: 'charlescousyn@gmail.com', // sender address
                                to: adress.Mail, // list of receivers
                                subject: 'Passage de la poubelle '+couleurPoubelle+" demain", // Subject line
                                html: myHtml
                            };

                            return promiseSendMail(mailOptions);
                        }
                    }
                    else
                    {
                        //Exécution du Calendrier
                        return Promise.all([promiseCheckCalendar(adress.CalendarId, date_collecte_start, date_collecte_end), date_collecte_start, date_collecte_end])
                            .then(([listEvents, date_collecte_start, date_collecte_end])=>
                            {
                                if (listEvents.length === 0)
                                {
                                    //Insertion
                                    console.log("Insertion of event "+couleurPoubelle+" at "+date_collecte_start.toISOString()+"...");
                                    return promiseInsertCalendar(adress.CalendarId, date_collecte_start, date_collecte_end, couleurPoubelle);
                                }
                                else
                                {
                                    console.log("Event "+couleurPoubelle+" already existing at "+date_collecte_start.toISOString()+", no insertion to do...");
                                    return false;
                                }
                            })
                            .then((data) =>
                            {
                                if(data !== false)
                                {
                                    console.log("Insertion of event "+couleurPoubelle+"  finished");
                                }
                            })
                            .catch(error =>
                            {
                                console.error(error);
                            });
                    }
                }));
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

    WorkFlowOneTypeOfGarbage();
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


//iteration();