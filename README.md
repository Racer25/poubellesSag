# poubellesSag
Project to automatically save dates for garbage in a google calendar  in th city of Saguenay (from https://ville.saguenay.ca/services-aux-citoyens/environnement/ordures-menageres/horaire-de-la-collecte)

# How to use the tool?
- First, create a config file named **"config.json"** at root of project and complete it using the format detailed  in  the file **"config.format.json"**

- Second, create a folder named **"calendarAPI"** at  root of project

- Third, in this last folder, create a file named **"settings.js"** and complete it as detailed in https://www.npmjs.com/package/node-google-calendar
(To do that, you'll need some information about Google Calendar API, it can be found at https://github.com/yuhong90/node-google-calendar/wiki#preparations-needed)

- Run the command **node app.js** and new events for garbage will be added on your google calendar (Update every hour while executing)
