/*The MIT License
Copyright (c) 2017 Ayhan AVCI
Permission is hereby granted, free of charge, to any person obtaining a copy of this software 
and associated documentation files (the "Software"), to deal in the Software without restriction, 
including without limitation the rights to use, copy, modify, merge, publish, distribute, 
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software 
is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in 
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, 
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE 
AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, 
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.*/

var registeredClients = new Map(); 
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', function connection(ws, req) {
  ws.on('message', function incoming(message) {
    const ip = req.connection.remoteAddress;        
    processMessage(ws, ip, message);
  });
  ws.on('close', function () {
    console.log('client closed');
    removeClient(ws);
    
  });
  sendAsJson(ws, "Socket Event", "Connected");
});

function processMessage(ws, ip, message)
{        
    console.log('Received from client Raw:[%s]', message); 
    var msg = JSON.parse(message);
    switch (msg.type)
    {
        case "Echo":
         console.log('Echo from client %s. Sending reply', msg.text);   
         sendAsJson(ws, "Echo", msg.text, "OK", "Server", msg.from, "Requested");               
         break;
        case "Socket Event":
         console.log('Socket Event received from client %s', msg.text);         
         break;
        case "ICE Candidate":
        onIceCandidate(ws, msg);              
        break;
        case "Session Description":
        break;
        case "Get Users":
        sendUsersList(ws, msg);
        break;
        case "Invite":
        onInvite(ws, msg);
        break;
        case "Hangup":
        onHangup(ws, msg);
        break;
        case "Caller Session Description":
        onCallerSessionDesc(ws, msg);
        break;        
        case "Callee Session Description":        
        onCalleeSessionDesc(ws, msg);
        break;
        case "Register":                                                    
            console.log("Registering client: %s. Total: %d", msg.text, registeredClients.size);            
            registerClient(ws, msg);
            sendAsJson(ws, "Register", msg.text, "OK", "Server", msg.from, "Requested",  registeredClients.size);
            sendUsersToAll();
        break;
 
    }
}

function registerClient(ws, msg)
{    
    var clientObject = {        
        name: msg.text,
        param1: "",
        param2: "",
        param3: "",    
        date: Date.now()
      };
    
    registeredClients.set(ws, JSON.stringify(clientObject));    
}
function removeClient(ws)
{    
    registeredClients.delete(ws);  
    sendUsersToAll();     
}

function sendUsersToAll()
{
    for (var [key, value] of registeredClients) {      
        var clientObject = JSON.parse(value);                  
        sendUsersList(key, clientObject.name);
    }  
}

function sendUsersList(ws, toString)
{      
    var response = {
        type: "Get Users",
        text: "OK",
        status: "OK",
        from: "Server",
        to: toString,
        reason: "Requested",
        param1: "",
        param2: "",        
        id:   "1",
        date: Date.now(),
        users: []
    };    
 
    for (var [key, value] of registeredClients) {  
        var clientObject = JSON.parse(value);               
        response.users.push({ 
            "name" : clientObject.name,
            "regdate"  : clientObject.date
        });
    }
    var responseString = JSON.stringify(response);
    console.log(responseString);
    ws.send(responseString);
}

function onHangup(ws, msg)
{
    switch (msg.text)
    {
        case "Local":
        sendRemoteHangup(ws, msg);  
        break;              
    }
}
function sendRemoteHangup(ws, msg)
{
    sendToOtherParty(ws, msg, "Hangup", "Remote", "Natural Hangup");
}
function onIceCandidate(ws, msg)
{
    sendToOtherParty(ws, msg, "ICE Candidate", msg.text, "");
}
function sendInviteRejectedToCaller(ws, msg)
{       
    sendToOtherParty(ws, msg, "Invite", "Start", "Rejected");
}
function sendInviteAcceptedToCaller(ws, msg)
{    
    sendToOtherParty(ws, msg, "Invite", "Start", "Accepted");
}
function sendInviteRingingToCaller(ws, msg)
{
    sendToOtherParty(ws, msg, "Invite", "Start", "Ringing");
}
function onCallerSessionDesc(ws, msg)
{    
    sendToOtherParty(ws, msg, "Caller Session Description", msg.text, "");
}
function onCalleeSessionDesc(ws, msg)
{
    sendToOtherParty(ws, msg, "Callee Session Description", msg.text, "");
}
function sendToOtherParty(ws, msg, commandString, msgString, statusString)
{
    console.log("sendToOtherParty, [%s]=>[%s] Called by:[%s]", msg.from, msg.to);
    var fFound = false;
    for (var [key, value] of registeredClients) {  
        var clientObject = JSON.parse(value);
        if (clientObject.name == msg.to)
        {
            fFound = true;
            console.log("sendToOtherParty. Found original caller. From:[%s] to [%s]", msg.from, msg.to);            
            sendAsJson(key, commandString, msgString, statusString, msg.from, msg.to); 
        }
    }   
    if (!fFound)
    {
        console.log("sendToOtherParty. Could not find other party. From:[%s] to [%s]", msg.from, msg.to);        
    }
}

function onInvite(ws, msg)
{
    switch (msg.text)
    {
        case "Start":
        sendInviteStartToCallee(ws, msg);        
        break;
        case "Accepted":
        sendInviteAcceptedToCaller(ws, msg);
        break;
        case "Ringing":
        sendInviteRingingToCaller(ws, msg);
        break;
        case "Rejected":
        sendInviteRejectedToCaller(ws, msg);
        break;
        case "Busy":
        //Not implemented
        break;
    }
}

function sendInviteStartToCallee(ws, msg)
{
    if (msg.from == msg.to) //Trying to call self
    {
        sendAsJson(ws, "Invite", "Start",  "Fail", msg.from, msg.to, "Cannot call self!"); //To Caller
        return;
    }
    var fFound = false;
    for (var [key, value] of registeredClients) {  
        var clientObject = JSON.parse(value);
        if (clientObject.name == msg.to)
        {
            console.log("sendInviteStartToCallee. Found callee. From:[%s] to [%s]", msg.from, msg.to);
            fFound = true;
            sendAsJson(key, "Invite", "Incoming", "", msg.from, msg.to); //To Callee
            sendAsJson(ws, "Invite", "Start", "Attempting", msg.from, msg.to); //To Caller
            break;
        }
    }    
    if (!fFound)
    {
        console.log("sendInviteStartToCallee. Could not find callee. From:[%s] to [%s]", msg.from, msg.to);
        sendAsJson(ws, "Invite", "Start",  "Fail", msg.from, msg.to); //To Caller
    }
}



function sendAsJson(ws, command, msgString, statusString, fromString, toString, reasonString, param1String, param2String)
{
    var msg = {
        type: command,
        text: msgString,
        status: statusString,
        from: fromString,
        to: toString,
        reason: reasonString,        
        param1: param1String,
        param2: param2String,        
        id:   "1",        
        date: Date.now()
      };
    ws.send(JSON.stringify(msg));
}

function heartbeat() {
    this.isAlive = true;
  }
  
  wss.on('connection', function connection(ws) {
    ws.isAlive = true;
    ws.on('pong', heartbeat);
  });
  
  const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
      if (ws.isAlive === false) return ws.terminate();
  
      ws.isAlive = false;
      ws.ping('', false, true);
    });
  }, 30000);