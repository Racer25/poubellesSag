// Modules
const axios = require("axios");
const qs = require("qs");
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

// Requests for https://ville.saguenay.ca/services-aux-citoyens/environnement/ordures-menageres/horaire-de-la-collecte
let getRuesRequest = async function (civicNumber)
{
    try
    {
        let response = await axios(
            {
                method: "post",
                url: "https://ville.saguenay.ca/ajax/collectes/getrues",
                headers: { "content-type": "application/x-www-form-urlencoded"},
                responseType: "application/json",
                data: qs.stringify({no_civique: civicNumber})
            });

        return response.data;
    }
    catch(err)
    {
        console.error(err);
    }
};
let getCollecteInfoRequest = async function (idBatiment)
{
    try
    {
        let response = await axios(
            {
                method: "post",
                headers: { "content-type": "application/x-www-form-urlencoded"},
                url: "https://ville.saguenay.ca/ajax/collectes/getcollecteinfo",
                responseType: "json",
                data: qs.stringify({ide: idBatiment})
            });

        return response.data.filter((thing, index, self) => index === self.findIndex(t => t.nom === thing.nom));

    }
    catch(err)
    {
        console.error(err);
    }
};

let getCeduleRequest = async function (horaire_id)
{
    try
    {
        let response = await axios(
            {
                method: "post",
                headers: { "content-type": "application/x-www-form-urlencoded"},
                url: "https://ville.saguenay.ca/ajax/collectes/getcedule",
                responseType: "json",
                data: qs.stringify({horaire_id: horaire_id})
            });

        return response.data;

    }
    catch(err)
    {
        console.error(err);
    }
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
let promiseGlobal = async function()
{
    let addresses = CONFIG.Adresses;
    let streetJsonTab = await Promise.all(addresses.map(address => getRuesRequest(address.CivicNumber)));
    let ids = streetJsonTab.map( (streetJson, index) => streetJson.find((elem) => elem.value === addresses[index].Street).id);
    let promisesGetRueRequest = addresses.map((address, index) => Promise.all([getCollecteInfoRequest(ids[index]), address]));

    /*
    let promisesGetRueRequest = addresses.map(async address =>
    {
        let streetJson = await getRuesRequest(address.CivicNumber);
        let id = streetJson.find((elem) => elem.value === address.Street).id;
        return Promise.all([getCollecteInfoRequest(id), address]);
        return [getCollecteInfoRequest(id), address];
    });*/

    return Promise.all(promisesGetRueRequest);
};

//Workflow for one type of garbage
let workFlow = async function()
{
    try
    {
        let collecteInfosAndAddresses = await promiseGlobal();

        //Create getCeduleRequests
        let promisesGetCeduleRequest = collecteInfosAndAddresses.map(collecteInfoAndAddress =>
        {
            let arrayOfGetCedulePromises = [];
            for(let i = 0; i < collecteInfoAndAddress[0].length; i++)
            {
                arrayOfGetCedulePromises.push(getCeduleRequest(collecteInfoAndAddress[0][i].horaire_id));
            }

            return Promise.all([Promise.all(arrayOfGetCedulePromises), collecteInfoAndAddress]);
        });

        //Wait all promise get cedule requests
        let  datesJsonTab = await Promise.all(promisesGetCeduleRequest);

        //For each home, do the appropriate process
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

                return createSendEmailsAndHandleCalendarPromises(couleurPoubelle, date_collecte, adress, date_collecte_start, date_collecte_end);

            }));
        });
        return Promise.all(promises);
    }
    catch (err)
    {
        console.error(err);
    }
};

let createSendEmailsAndHandleCalendarPromises = async function(couleurPoubelle, date_collecte, adress, date_collecte_start, date_collecte_end)
{
    if(adress.MailNotCalendar)
    {
        let dateNow = new Date();
        const hourStartMail = 14;
        const hourEndMail = 15;

        //Si on est la veille du passage et qu'il est entre 14h et 15h
        if(dateNow.getFullYear() === date_collecte.getFullYear() &&
            dateNow.getMonth() === date_collecte.getMonth() &&
            dateNow.getDate() === date_collecte.getDate() &&
            dateNow.getHours() > hourStartMail && dateNow.getHours() < hourEndMail)
        {
            console.log(`Sending mail to ${adress.Mail}...`);
            //Envoyer mail
            //Init html of the mail
            let myHtml="<div><p>Il faut sortir la poubelle " + couleurPoubelle + " aujourd'hui!!</p></div>";

            let mailOptions = {
                from: 'charlescousyn@gmail.com', // sender address
                to: adress.Mail, // list of receivers
                subject: 'Passage de la poubelle ' + couleurPoubelle + " demain", // Subject line
                html: myHtml
            };

            return promiseSendMail(mailOptions);
        }
        else
        {
            console.log(`Mail to ${adress.Mail} will be sent the ${date_collecte} between ${hourStartMail} and ${hourEndMail}`);
        }
    }
    else
    {
        //Exécution du Calendrier
        let listEvents = await promiseCheckCalendar(adress.CalendarId, date_collecte_start, date_collecte_end);

        let prom;
        if (listEvents.length === 0)
        {
            //Insertion
            console.log("Insertion of event "+couleurPoubelle+" at "+date_collecte_start.toISOString()+"...");
            await promiseInsertCalendar(adress.CalendarId, date_collecte_start, date_collecte_end, couleurPoubelle);
            console.log("Insertion of event "+couleurPoubelle+"  finished");
        }
        else
        {
            console.log("Event "+couleurPoubelle+" already existing at "+date_collecte_start.toISOString()+", no insertion to do...");
        }
    }
};

// Function to loop
let iteration = function ()
{
    console.log("\n/** Update of of garbage dates at "+ new Date().toISOString()+" **/");
    //Init calendar
    cal = new CalendarAPI(CONFIG_CALENDAR);

    workFlow().then();
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