const config = {
    tabTitle: "Weathercards",
    settings: [
        {
            id: "weather-wxApiKey",
            name: "API Key",
            description: "API Key from https://openweathermap.org/api",
            action: { type: "input", placeholder: "Open Weather Map API Key" },
        },
        {
            id: "weather-weatherDefaultLocation",
            name: "Location",
            description: "City, Country",
            action: { type: "input", placeholder: "melbourne,au" },
        },
        {
            id: "weather-wxUnits",
            name: "Units",
            description: "Set this to imperial or metric as desired",
            action: { type: "input", placeholder: "metric" },
        },
        {
            id: "weather-number",
            name: "How Many Days?",
            description: "How many cards would you like to show?",
            action: { type: "select", items: ["Today Only", "2", "3", "4", "5", "6", "7", "8"] },
        },
    ]
};

// copied and adapted from https://github.com/dvargas92495/roamjs-components/blob/main/src/writes/createBlock.ts
const createBlock = (params) => {
    const uid = window.roamAlphaAPI.util.generateUID();
    return Promise.all([
        window.roamAlphaAPI.createBlock({
            location: {
                "parent-uid": params.parentUid,
                order: params.order,
            },
            block: {
                uid,
                string: params.node.text
            }
        })
    ].concat((params.node.children || []).map((node, order) =>
        createBlock({ parentUid: uid, order, node })
    )))
};

export default {
    onload: ({ extensionAPI }) => {
        extensionAPI.settings.panel.create(config);

        extensionAPI.ui.commandPalette.addCommand({
            label: "Weathercards",
            callback: () => {
                const uid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
                weather().then(async (blocks) => {
                    if (uid != undefined) {
                        const pageId = window.roamAlphaAPI.pull("[*]", [":block/uid", uid])?.[":block/page"]?.[":db/id"];
                        const parentUid = window.roamAlphaAPI.pull("[:block/uid]", pageId)?.[":block/uid"];
                        blocks.forEach((node, order) => createBlock({
                            parentUid,
                            order,
                            node
                        }));
                    } else {
                        var uri = window.location.href;
                        const regex = /^https:\/\/roamresearch.com\/.+\/(app|offline)\/\w+$/; //today's DNP
                        if (regex.test(uri)) { // this is Daily Notes for today
                            var today = new Date();
                            var dd = String(today.getDate()).padStart(2, '0');
                            var mm = String(today.getMonth() + 1).padStart(2, '0');
                            var yyyy = today.getFullYear();
                            var pageBlock = "" + mm + "-" + dd + "-" + yyyy + "";
                        }
                        const parentUid = pageBlock || await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
                        blocks.forEach((node, order) => createBlock({
                            parentUid,
                            order,
                            node
                        }));
                    }
                });
            },
        });

        const args = {
            text: "WEATHERCARDS",
            help: "Import the weather forecast from Open Weather Map",
            handler: (context) => weather,
        };

        if (window.roamjs?.extension?.smartblocks) {
            window.roamjs.extension.smartblocks.registerCommand(args);
        } else {
            document.body.addEventListener(
                `roamjs:smartblocks:loaded`,
                () =>
                    window.roamjs?.extension.smartblocks &&
                    window.roamjs.extension.smartblocks.registerCommand(args)
            );
        }

        async function weather() {
            var key, wxUnits;
            breakme: {
                if (!extensionAPI.settings.get("weather-wxApiKey")) {
                    key = "API";
                    sendConfigAlert(key);
                    break breakme;
                } else if (!extensionAPI.settings.get("weather-weatherDefaultLocation")) {
                    key = "location";
                    sendConfigAlert(key);
                    break breakme;
                } else {
                    const wxApiKey = extensionAPI.settings.get("weather-wxApiKey");
                    const wxLocation = extensionAPI.settings.get("weather-weatherDefaultLocation");
                    if (extensionAPI.settings.get("weather-wxUnits")) {
                        const regex = /^metric|imperial$/;
                        if (regex.test(extensionAPI.settings.get("weather-wxUnits"))) {
                            wxUnits = extensionAPI.settings.get("weather-wxUnits");
                        } else {
                            key = "units";
                            sendConfigAlert(key);
                            break breakme;
                        }
                    } else {
                        wxUnits = "metric";
                    }
                    var wxNumber = 1;
                    if (extensionAPI.settings.get("weather-number") != "Today Only") {
                        wxNumber = parseInt(extensionAPI.settings.get("weather-number"));
                    }

                    function toSentenceCase(str) {
                        if ((str === null) || (str === '')) {
                            return;
                        } else {
                            str = str.toString();
                            return str.replace(/\w\S*/g, function (txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
                        }
                    }

                    /* fetch weather forecast data */
                    var url = 'https://api.openweathermap.org/geo/1.0/direct?q='
                        + wxLocation
                        + '&limit=1&'
                        + 'APPID=' + wxApiKey;
                    var requestResults = await fetch(url);
                    var dataResults = await requestResults.json();

                    var lat = dataResults[0].lat;
                    var lon = dataResults[0].lon;
                    if (dataResults[0].state) {
                        var wxLocationName = dataResults[0].name + ', ' + dataResults[0].state + ' (' + dataResults[0].country + ')';
                    } else {
                        var wxLocationName = dataResults[0].name + ' (' + dataResults[0].country + ')';
                    }

                    var url = 'https://api.openweathermap.org/data/3.0/onecall?'
                        + 'lat=' + lat + '&lon=' + lon
                        + '&units=' + wxUnits + '&'
                        + 'exclude=minutely,hourly&'
                        + 'APPID=' + wxApiKey;
                    var requestResults = await fetch(url);
                    var dataResults = await requestResults.json();
                    console.info(dataResults);
                    if (dataResults.hasOwnProperty("cod") && dataResults.cod == 401) {
                        key = "API3";
                        sendConfigAlert(key);
                        break breakme;
                    } else {
                        var curTimezone = new Date().getTimezoneOffset();
                        var weatherTimezone = dataResults.timezone_offset / 60 * -1;
                        var tzDiff = curTimezone - weatherTimezone;
                        var wxAlerts = '';
    
                        let days = [];
                        for (var i = 0; i < parseInt(wxNumber); i++) {
                            const date = new Date(dataResults.daily[i].dt * 1000);
                            var wxDay = '**' + date.customFormat("#DDDD#, #MMM# #DD#, #YYYY#") + '**';
                            var wxDescription = toSentenceCase(dataResults.daily[i].weather[0].description);
                            var wxHighTemperature = Math.round(dataResults.daily[i].temp.max);
                            var wxLowTemperature = Math.round(dataResults.daily[i].temp.min);
                            var wxMorning = Math.round(dataResults.daily[i].temp.morn);
                            var wxAfternoon = Math.round(dataResults.daily[i].temp.day);
                            var wxEvening = Math.round(dataResults.daily[i].temp.eve);
                            var wxPrecip = Math.round(dataResults.daily[i].pop * 100);
                            var wxInfo = "";
    
                            if (i == 0) {
                                var wxDescriptionCur = toSentenceCase(dataResults.current.weather[0].description);
                                var wxConditions = dataResults.current.weather[0].main;
                                var wxCurTemperature = Math.round(dataResults.current.temp);
                                var wxHumidity = Math.round(dataResults.current.humidity);
                                const dateS = new Date(dataResults.current.sunrise * 1000);
                                var wxSunrise = '' + dateS.customFormat("#h#:#mm# #AMPM#") + '';
                                const dateSS = new Date(dataResults.current.sunset * 1000);
                                var wxSunset = '' + dateSS.customFormat("#h#:#mm# #AMPM#") + '';
                                var wxWindSpeed = Math.round(dataResults.current.wind_speed);
                                if (wxUnits == "imperial") {
                                    wxWindSpeed += "mph";
                                } else {
                                    wxWindSpeed = Math.round(parseInt(wxWindSpeed) * 3.6);
                                    wxWindSpeed += "kph";
                                }
    
                                wxInfo += '**Today, **' + wxDay + '\n'
                                    + '\n'
                                    + '**Currently: **' + wxDescriptionCur + ' (' + wxCurTemperature + '°)\n'
                                    + '**Forecast: **' + wxDescription + ' (' + wxHighTemperature + '°/' + wxLowTemperature + '°)\n'
                                    + '**Morn: **' + wxMorning + '° **Day: **' + wxAfternoon + '° **Eve: **' + wxEvening + '°\n'
                                    + '**Prec: **' + wxPrecip + '% **Wind: **' + wxWindSpeed + ' **Hum: **' + wxHumidity + '%\n'
                                    + '**Sunrise: **' + wxSunrise + ' **Sunset: **' + wxSunset + ' '
                                    + ' #wx-fc #weathercard #\[\[wx-' + wxConditions + '\]\]';
                            } else {
                                var wxConditions = dataResults.daily[i].weather[0].main;
                                const dateS = new Date(dataResults.daily[i].sunrise * 1000);
                                var wxSunrise = '' + dateS.customFormat("#h#:#mm# #AMPM#") + '';
                                const dateSS = new Date(dataResults.daily[i].sunset * 1000);
                                var wxSunset = '' + dateSS.customFormat("#h#:#mm# #AMPM#") + '';
                                var wxHumidity = Math.round(dataResults.daily[i].humidity);
                                var wxWindSpeed = Math.round(dataResults.daily[i].wind_speed);
                                if (wxUnits == "imperial") {
                                    wxWindSpeed += "mph";
                                } else {
                                    wxWindSpeed = Math.round(parseInt(wxWindSpeed) * 3.6);
                                    wxWindSpeed += "kph";
                                }
                                var wxPrecip = Math.round(dataResults.daily[i].pop * 100);
                                wxInfo += wxDay + '\n'
                                    + '\n'
                                    + '**Forecast: **' + wxDescription + ' (' + wxHighTemperature + '°/' + wxLowTemperature + '°)\n'
                                    + '**Morn: **' + wxMorning + '° **Day: **' + wxAfternoon + '° **Eve: **' + wxEvening + '°\n'
                                    + '**Prec: **' + wxPrecip + '% **Wind: **' + wxWindSpeed + ' **Hum: **' + wxHumidity + '%\n'
                                    + '**Sunrise: **' + wxSunrise + ' **Sunset: **' + wxSunset + ' '
                                    + ' #wx-fc #weathercard #\[\[wx-' + wxConditions + '\]\]';
                            }
                            days.push({ "text": wxInfo });
                        }
                        // update header 
                        const dateU = new Date(dataResults.current.dt * 1000);
                        var wxUpdateTime = '' + dateU.customFormat("#hhh#:#mm# #AMPM#") + '';
    
                        if (dataResults.alerts) {
                            wxAlerts = '\n((\n'
                                + dataResults.alerts[0].description.replace(/\n\*/g, 'linebreak').replace(/\n/g, ' ').replace(/linebreak/g, '\n*')
                                + '))';
                        }
    
                        return [
                            {
                                text: '**' + wxLocationName + '** __' + wxUpdateTime + '__' + wxAlerts + ' #rm-grid #rm-grid-3c #.wx-header'.toString(),
                                children: days
                            },
                        ];
                    }
                };
            }
        }
    },
    onunload: () => {
        if (window.roamjs?.extension?.smartblocks) {
            window.roamjs.extension.smartblocks.unregisterCommand("WEATHERCARDS");
        };
    }
}

function sendConfigAlert(key) {
    if (key == "API") {
        alert("Please set the API key from https://openweathermap.org/api in the configuration settings via the Roam Depot tab.");
    } else if (key == "location") {
        alert("Please set your location in the format city, country (e.g. melbourne, au or berlin, de) in the configuration settings via the Roam Depot tab.");
    } else if (key == "units") {
        alert("Please set your preferred units of measurement (metric or imperial) in the configuration settings via the Roam Depot tab.");
    } else if (key == "API3") {
        alert("Please subscribe to the updated OpenWeather One Call API 3.0 at https://openweathermap.org/api as the old API is deprecated. Once your new subscription is confirmed you should be able to use Weathercards as before without any change in settings.");
    }
}

//*** This code is copyright 2002-2016 by Gavin Kistner, !@phrogz.net
//*** It is covered under the license viewable at http://phrogz.net/JS/_ReuseLicense.txt
Date.prototype.customFormat = function (formatString) {
    var YYYY, YY, MMMM, MMM, MM, M, DDDD, DDD, DD, D, hhhh, hhh, hh, h, mm, m, ss, s, ampm, AMPM, dMod, th;
    YY = ((YYYY = this.getFullYear()) + "").slice(-2);
    MM = (M = this.getMonth() + 1) < 10 ? ('0' + M) : M;
    MMM = (MMMM = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][M - 1]).substring(0, 3);
    DD = (D = this.getDate()) < 10 ? ('0' + D) : D;
    DDD = (DDDD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][this.getDay()]).substring(0, 3);
    th = (D >= 10 && D <= 20) ? 'th' : ((dMod = D % 10) == 1) ? 'st' : (dMod == 2) ? 'nd' : (dMod == 3) ? 'rd' : 'th';
    formatString = formatString.replace("#YYYY#", YYYY).replace("#YY#", YY).replace("#MMMM#", MMMM).replace("#MMM#", MMM).replace("#MM#", MM).replace("#M#", M).replace("#DDDD#", DDDD).replace("#DDD#", DDD).replace("#DD#", DD).replace("#D#", D).replace("#th#", th);
    h = (hhh = this.getHours());
    if (h == 0) h = 24;
    if (h > 12) h -= 12;
    hh = h < 10 ? ('0' + h) : h;
    hhhh = hhh < 10 ? ('0' + hhh) : hhh;
    AMPM = (ampm = hhh < 12 ? 'am' : 'pm').toUpperCase();
    mm = (m = this.getMinutes()) < 10 ? ('0' + m) : m;
    ss = (s = this.getSeconds()) < 10 ? ('0' + s) : s;
    return formatString.replace("#hhhh#", hhhh).replace("#hhh#", hhh).replace("#hh#", hh).replace("#h#", h).replace("#mm#", mm).replace("#m#", m).replace("#ss#", ss).replace("#s#", s).replace("#ampm#", ampm).replace("#AMPM#", AMPM);
};