// this variable can be modified by the users (TODO place in separate config file)
var openPort = 8888;

// TODO update this list of requires to only include the one's used in the local version of pandolab
var express = require('express')
  , RedisStore = require('connect-redis')(express)
  , sessionStore = new RedisStore()
  , http = require('http')
  , fs = require('fs')
  , passport = require('passport')
  , LocalStrategy = require('passport-local').Strategy
  , mongodb = require('mongodb')
  , path = require('path')
  , nodemailer = require('nodemailer')
  , mongoose = require('mongoose')
  , bcrypt = require('bcrypt')
  , SALT_WORK_FACTOR = 10;
  
var LabSession = require('./labsession.js');
var AdmZip = require('adm-zip');

var activeSessions = {};

var app = express();
var server = http.createServer(app);

// configure Express
app.configure(function() {
  app.use(express.logger()); // this is for log files (not sure that I am actually making use of this though)
  app.use(express.bodyParser()); // TODO Check to make sure this is still needed
  app.use(express.methodOverride()); // TODO Check to make sure this is still needed
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

/* Try to get by without this, local users will need to enter a lab and managers should add the manager component of the url
app.get('/', function(req, res) {
        res.redirect('/manager');
});
*/

// Check if there is an active session that should be destroyed
app.get('/new-lab', function(req, res) {
    // first check to see if there is a running experiment
    if (typeof activeSessions.lab !== 'undefined' && activeSessions.lab.isRunning() === true) {
        // do nothing: wait for manager to end the currently running treatment.
        console.log("running=yes: " + JSON.stringify(activeSessions));
    } else {
        // destroy activeSession for this user
        // console.log("isRunning: " + activeSessions.lab.isRunning());
        // console.log("running?: " + JSON.stringify(activeSessions));
        if (typeof activeSessions.lab !== 'undefined') {
            activeSessions.lab.close();
        }
        activeSessions = {};
    }
    // redirect to manager: manager will create the new session
    res.redirect('/manager');
});

app.get('/help', function(req, res) {
    fs.readFile(__dirname + '/help.html',
        function (err, data) {
        if (err) {
            res.writeHead(500);
            return res.end('Error loading help.html');
        }
        res.send(data.toString());
    });
});

app.get('/logs', function(req, res) {
    fs.readFile(__dirname + '/log.html',
        function (err, data) {
        if (err) {
            res.writeHead(500);
            return res.end('Error loading log.html');
        }
        // TODO if you use modulus for hosting change __dirname to process.env.CLOUD_DIR
        fs.exists(__dirname + "/logs/", function(dirExists) {
            if (!dirExists) {
                fs.mkdir(__dirname + "/logs/", function(err) {
                    if (err) { throw(err); }
                });
            }
            // now it's safe to read the dir
            fs.readdir(__dirname + "/logs/", function(err, files){
                if (err) { throw(err); }
                var content = "";
                for (var i = 0; i < files.length; i++) {
                    if (files[i].indexOf(".csv") > -1) {
                        content += "<li class='list-group-item'><a href='/logs/" + files[i] + "'>" + files[i] + "</a></li>";
                    }
                }
                res.send(data.toString().replace("CONTENT", content));
            });
        });
    });
});

// download function for example zip's
app.get(/(\/examples\/[a-zA-Z_0-9]+\.zip)$/, function(req, res) {
    res.download(__dirname + req.params[0]);
});

// requests to download csv's
app.get(/logs\/([a-zA-Z_0-9]+\.csv)$/, function(req, res) {
    // TODO if you use modulus for hosting change __dirname to process.env.CLOUD_DIR
    var logPath = __dirname + "/logs/";
    fs.readdir(logPath, function(err, files){
        if (err) { throw(err); }
            for (var i = 0; i < files.length; i++) {
                if (req.params[0] === files[i]) {
                    res.download(logPath + files[i]);
                }
            }
    });
});

// this is the homepage for experiment managers
app.get('/manager', function(req, res){
    var shortCode = "conn";
    // If the user already has a live lab session, send the lab updates to the manager's view
    // Else: create a new LabSession object, assign a shortCode and connect the labsession to the manager's view
    // That is, at this point, make sure the user receives the manager shell with the correct shortCode (i.e., connection url)
    if (typeof activeSessions.lab !== 'undefined') {
        // send user the current lab view
        shortCode = activeSessions.shortCode;
    } else {
        // create shortCode
        var chars = "2345679abcdefghjkmnpqrstuvwxyz";
        shortCode = "";
        for (var i = 0; i < 6; i++) {
            shortCode += chars.charAt(Math.floor(Math.random() * 31));
        }

        // check to make sure the correct folders exist (treatments and logs)
        fs.exists(__dirname + "/treatments/", function(insideExists) {
            if (!insideExists) {
                fs.mkdir(__dirname + "/treatments/", function(err) {
                    if (err) { throw(err); }
                    // create LabSession
                    var lab = new LabSession(__dirname + "/treatments/", shortCode, app, server);
                    // set the activeSessions entry
                    activeSessions = {shortCode: shortCode, lab: lab};
                    fs.exists(__dirname + "/treatments/", function(logExists) {
                        if (!logExists) {
                            fs.mkdir(__dirname + "/logs/", function(err) {
                                if (err) { throw(err); }
                            });
                        }
                    });
                });
            } else {
                // create LabSession
                var lab = new LabSession(__dirname + "/treatments/", shortCode, app, server);
                // set the activeSessions entry
                activeSessions = {shortCode: shortCode, lab: lab};
            }
        });
    }

    fs.readFile(__dirname + '/mgr_shell.html', function (err, data) {
        if (err) {
            res.writeHead(500);
            return res.end('Error loading shell.html');
        }
        res.send(data.toString().replace("shortCode", shortCode));
    });
});

// TODO implement
app.post('/delete-treatment', function(req, res) {
    console.log("deleting treatment ");
});

app.post('/upload-zip', function(req, res) {
    console.log("size: " + JSON.stringify(req.files.files[0].size));
    console.log("path: " + JSON.stringify(req.files.files[0].path));
    console.log("name: " + JSON.stringify(req.files.files[0].name));
    console.log("type: " + JSON.stringify(req.files.files[0].type));
    var file = req.files.files[0];
    // check that the file type is a zip
    if(file.type === "application/zip") {
        console.log("this is a zip");
        var dirName = file.name.replace(/\.zip$/, "");
        var zip = new AdmZip(file.path);
        var zipEntries = zip.getEntries(); // an array of ZipEntry records
        var zipPath = "";

        zipEntries.forEach(function(zipEntry) {
            console.log("name: " + zipEntry.name);
            console.log("entryName: " + zipEntry.entryName);
            
            if (zipEntry.name === "treatment.json") {
                zipPath = zipEntry.entryName.replace(zipEntry.name, "");
                console.log("Found treatment.json at " + zipPath); 
            }
        });
        // now zipPath contains the path to extract
        // see if the proposed dirName is available
        fs.readdir(__dirname + "/treatments/", function(err, files){
            console.log(files);
            if (err) { throw(err); }
            var dirNameUnique = false;
            // this is a dumb implementation where I just add "x"s until I have a unique folder name
            while (dirNameUnique === false) {
                dirNameUnique = true;
                for (var i = 0; i < files.length; i++) {
                    if (dirName === files[i]) {
                        dirNameUnique = false;
                        dirName += "x";
                    }
                }
            }
            // now dirName is unique, time to unzip to the unique directory
            var targetPath = __dirname + "/treatments/" + dirName;
            fs.mkdir(targetPath, function(err){
                if(err) { throw(err); }
                // extract to the the new directory
                if (zipPath.length === 0) {
                    zip.extractAllTo(targetPath);
                    // add the newly add dirName to availableTreatments in lab
                    res.send({nested: false, files: files});
                } else {
                    zip.extractEntryTo(zipPath, targetPath);
                    // add the newly add dirName to availableTreatments in lab
                    res.send({nested: true, files: files});
                }
                // TODO rezip the file for future downloads
            });

        })
    } else {
        console.log("this is not a zip");
        // TODO send user note that this is not the right file type
    }
    // TODO check for a treatment.json
    // TODO check for nested treatments
    // TODO copy to the treatments folder and reload the available treatments list.
});

server.listen(openPort, function() {
  console.log('Express server listening on port ' + openPort);
});
