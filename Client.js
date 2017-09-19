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
'use strict';

var signallingServer = 'ws://192.168.0.18:8080';

var callButton = document.getElementById('callButton');
var acceptButton = document.getElementById('acceptButton');
var rejectButton = document.getElementById('rejectButton');
var hangupButton = document.getElementById('hangupButton');
var connectButton = document.getElementById('connectButton');
var sendTestButton = document.getElementById('sendTestButton');
var getUsersButton = document.getElementById('getUsersButton');
var clientNameText = document.getElementById('clientName');
var signallingLabel = document.getElementById('signallingLabel');
var phonestateImg = document.getElementById('phonestateImg');
var enableSound = document.getElementById('enableSound');
var enableVideo = document.getElementById('enableVideo');
var enableBoth = document.getElementById('enableBoth');

var clientId = "";
var remoteParty = "";

callButton.onclick = call;
acceptButton.onclick = accept;
rejectButton.onclick = reject;
hangupButton.onclick = hangup;
connectButton.onclick = Connect;
sendTestButton.onclick = sendtest;

var servers = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]}; //null is also acceptable
var peerConnection = null;
var pcConstraints = {
    'optional': []
};
var offerOptions = {
    offerToReceiveAudio: 1, 
    offerToReceiveVideo: 1,
    voiceActivityDetection: false
};

var mediaConstraints = {
    audio: true, 
    video: true
};

var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');

var serverSocket;
var localStream;
var remoteStream;

var lsStarted = false;
var pcStarted = false;
var registered = false;

setNAState();

function mediaSuccessCallback(stream) {    
    localStream = stream;
    localVideo.src = window.URL.createObjectURL(stream);
    lsStarted = true;
}
function mediaErrorCallback(error) {
    console.log('navigator.getUserMedia error: ', error);
    switch(error.name) {
        case "NotFoundError":          
          break;
        case "SecurityError":
          break;
        case "PermissionDeniedError":          
          break;
        default:          
          break;
      }
}

function startLocalStream() 
{
    console.log('startLocalStream');    
    mediaConstraints.audio = enableSound.checked || enableBoth.checked;
    mediaConstraints.video = enableVideo.checked || enableBoth.checked;   
  
        
    navigator.mediaDevices.getUserMedia(mediaConstraints).then(mediaSuccessCallback).catch(mediaErrorCallback);   
}

function call() 
{
    console.log('call');
    
    var userList = document.getElementById("usersList");
    if (userList.length == 0) {
        alert('empty user list.');
        return;
    }
        
    var destinationName = userList[userList.selectedIndex].text;
            
    remoteParty = destinationName;
    sendAsJson("Invite", "Start", destinationName);   
    
}
function reject()
{
    console.log("Rejecting call [%s]=>[%s]. ", remoteParty, clientId);
    sendAsJson("Invite", "Rejected", remoteParty);
    setIdleState();    
}

function accept()
{
    console.log("Accepting call. [%s]=>[%s]. ", remoteParty, clientId);        
    sendAsJson("Invite", "Accepted", remoteParty);
    setAcceptedState();
}

function onMessageInvite(msg)
{
    if (msg.text == "Incoming")
    {
        console.log("Incoming call detected. [%s]=>[%s].", msg.from, msg.to);        
        setRingingState(true, "Ringing (from: [" + msg.from + "])");
        remoteParty = msg.from;
        sendAsJson("Invite", "Ringing", msg.from);
    }
    else if (msg.text == "Start") //Responses
    {
        if (msg.status == "Attempting") 
        {                                    
            setAttemptingState("Attempting Call:[" + msg.from + "]=>[" + msg.to + "]")
        }
        else if (msg.status == "Ringing") 
        {            
            setRingingState(false, "Remote Ringing [" + msg.from + "]");
        }
        else if (msg.status == "Busy")
        {
            setIdleState();
        }
        else if (msg.status == "Rejected")
        {
            setIdleState();
        }
        else if (msg.status == "Fail")
        {            
            setIdleState();
        }
        else if (msg.status == "Accepted") 
        {
            setAcceptedState();
            createPeerConnection();            
            createOffer();
        }
    }    
}
function onMessageHangup(msg)
{
    if (msg.text == "Remote")
    {
        if (peerConnection != null)       
        {
            if (peerConnection.connectionState != "closed")
                peerConnection.close();
        } 
        console.log("Remote hangup. [%s] - [%s]", msg.from, msg.to);
        setIdleState();        
    }    
}

function onMessageGetUsers(msg)
{
    var userList = document.getElementById("usersList");
    while (userList.length > 0) {                
        userList.remove(0);
    } 

    for (var i = 0; i < msg.users.length; i++) {
        console.log("Get Users result: %s - %s", msg.users[i].name, msg.users[i].regdate);
        if (msg.users[i].name == clientId) //self
            continue;
        
        var item = document.createElement("option");
        item.text = msg.users[i].name;
        userList.options.add(item, 1);        
    } 
}

function onMessageCallerSessionDesc(msg)
{
    createPeerConnection();  
    peerConnection.setRemoteDescription(new RTCSessionDescription(msg.text));
    createAnswer(msg);
}

function onMessageCaleeSessionDesc(msg)
{
    peerConnection.setRemoteDescription(new RTCSessionDescription(msg.text));
}

function onMessageICECandidate(msg)
{
    console.log("adding ice candidate: ", msg.text);
    peerConnection.addIceCandidate(new RTCIceCandidate(msg.text));
}

function createPeerConnection()
{
    peerConnection = new RTCPeerConnection(servers, pcConstraints);    
    peerConnection.onaddstream = onRemoteStreamAdded;    
    peerConnection.onicecandidate = onIceCandidate;
    //peerConnection.onconnecting = onSessionConnecting;
    //peerConnection.onopen = onSessionOpened;
    //peerConnection.onremovestream = onRemoteStreamRemoved;     
    peerConnection.addStream(localStream);   
}   

function createOffer()
{        
    offerOptions.offerToReceiveAudio = enableSound.checked || enableBoth.checked;
    offerOptions.offerToReceiveAudio = enableVideo.checked || enableBoth.checked;         
    
    peerConnection.createOffer(offerOptions).then(onOfferCreated, onOfferError);
}

function createAnswer(msg)
{
    peerConnection.createAnswer().then(onAnswerCreated, onAnswerError);;
}

function onOfferCreated(/*RTCSessionDescription*/sessionDescription) 
{ 
    peerConnection.setLocalDescription(sessionDescription);
    sendAsJson("Caller Session Description", sessionDescription, remoteParty);   
}

function onAnswerCreated(/*RTCSessionDescription*/sessionDescription) 
{     
    peerConnection.setLocalDescription(sessionDescription);
    sendAsJson("Callee Session Description", sessionDescription, remoteParty);  
}

function onOfferError(/*DOMError*/error)
{
    console.log(error);
}

function onAnswerError(/*DOMError*/error)
{
    console.log(error);
}

function onRemoteStreamAdded(event) 
{
    console.log("onRemoteStreamAdded");
    remoteStream = event.stream;
    //remoteVideo.src =  window.URL.createObjectURL(remoteStream);          
    remoteVideo.srcObject = remoteStream;
}

function onSessionConnecting()
{
    console.log("onSessionConnecting");
}

function onIceCandidate(event) {
    if (event.candidate) {        
        //event.candidate.candidate, event.candidate.sdpMLineIndex, event.candidate.sdpMid  
        sendAsJson("ICE Candidate", event.candidate, remoteParty);
    } else {
      console.log("End of candidates.");
    }
}

function hangup() 
{
    console.log('hangup');
    if (serverSocket.readyState == 1 && registered == true)
    {        
        if (peerConnection != null)       
        {
            if (peerConnection.connectionState != "closed")
                peerConnection.close();
        } 
            
        sendAsJson("Hangup", "Local", remoteParty);   
        setIdleState();                      
    }    
}

function sendtest() 
{
    console.log('send echo test');
   

    if (serverSocket.readyState == 1)
    {        
        sendAsJson("Echo", "Echo from client");
    }
}

function getusers()
{    
    console.log('%s %s', serverSocket.readyState, registered);
    if (serverSocket.readyState == 1 && registered == true)
    {
        sendAsJson("Get Users");
    }
}

function Connect()
{    
    if (valid('clientName') == false)
        return;    
    serverSocket = new WebSocket(signallingServer);  
    serverSocket.onmessage = onSocketMessage;
    serverSocket.onclose = onSocketClose;
    serverSocket.onopen = onSocketOpen;
    serverSocket.onclose = onSocketClose;
    window.onbeforeunload = onSocketBeforeunload; 
}

function sendAsJson(command, msgString, toString, reasonString, statusString, param1String, param2String)
{
    var msg = {
        type: command,
        text: msgString,
        status: statusString,
        from: clientId,
        to: toString,
        reason: reasonString,        
        param1: param1String,
        param2: param2String,        
        id:   "1",        
        date: Date.now()
      };
      var msgString = JSON.stringify(msg);
      console.log('Sending %s', msgString);
      serverSocket.send(msgString);      
}

function dcfromserver() 
{
    console.log('send');
    serverSocket.close();
}

function onSocketOpen()
{
    // Web Socket is connected   
    console.log("connected");
    document.getElementById('sockStatLabel').innerText = "Server: Connected";
    connectButton.disabled = true;    
    clientId = clientNameText.value;
    sendAsJson("Register", clientNameText.value);  
};
 
function onSocketMessage(event)
{    
    console.log("Raw Data [%s]", event.data);
   var msg = JSON.parse(event.data);
   switch (msg.type)
   {
       case "Echo":
        console.log('Echo received from server [%s]', msg.text);
        break;
       case "Socket Event":
        console.log('Socket Event received from server [%s]', msg.text);
        break;      
       case "Register":
        console.log('Register received from server %s : %s. Result:%d', msg.text, msg.status, msg.param1);
        if (msg.status == "OK") {
            registered = true;            
            setIdleState();
            startLocalStream(); 
        } 
            
        break;
        case "Get Users":
        onMessageGetUsers(msg);
        break;
        case "Invite":
        console.log('Invite received from server Msg:[%s] Status:[%s] From:[%s] To:[%s]', msg.text, msg.status, msg.from, msg.to);
        signallingLabel.innerText = "Sent Invite [" + msg.from + "]=>[" + msg.to + "]";
        onMessageInvite(msg);
        break;
        case "Hangup":
        onMessageHangup(msg);
        break;
        case "Caller Session Description":
        onMessageCallerSessionDesc(msg);
        break;        
        case "Callee Session Description":
        onMessageCaleeSessionDesc(msg);
        break;
        case "ICE Candidate":
        onMessageICECandidate(msg);
        break;

   }   
};

function onSocketClose()
{
    console.log('websocket is closed');
    document.getElementById('sockStatLabel').innerText = "Server: Disconnected";    
    setNAState();
};
     
function onSocketBeforeunload(event) 
{
   console.log('onbeforeunload');
   socket.close();
};

function setNAState()
{
    signallingLabel.innerText = "Call State: N/A";
    connectButton.disabled = false;
    registered = false;   
    acceptButton.disabled = true;
    rejectButton.disabled = true;
    callButton.disabled = true;
    hangupButton.disabled = true;
    connectButton.disabled = false;
    sendTestButton.disabled = true;
}

function setIdleState()
{
    signallingLabel.innerText = "Idle";
    phonestateImg.src = "./images/idle.png"
    remoteParty = "";
    acceptButton.disabled = true;
    rejectButton.disabled = true;
    callButton.disabled = false;
    hangupButton.disabled = true;
    connectButton.disabled = true;
    sendTestButton.disabled = false;
}

function setRingingState(isLocal, labelText)
{
    signallingLabel.innerText = labelText;
    phonestateImg.src = "./images/ringing.gif";

    acceptButton.disabled = !isLocal;
    rejectButton.disabled = !isLocal;
    callButton.disabled = true;
    hangupButton.disabled = false;
    connectButton.disabled = true;
    sendTestButton.disabled = false;
}

function setAcceptedState()
{
    signallingLabel.innerText = "Call Started!";
    phonestateImg.src = "./images/accepted.png"
    acceptButton.disabled = true;
    rejectButton.disabled = true;
    callButton.disabled = true;
    hangupButton.disabled = false;
    connectButton.disabled = true;
    sendTestButton.disabled = false;
}

function setAttemptingState(labelText)
{
    signallingLabel.innerText = labelText;
    acceptButton.disabled = true;
    rejectButton.disabled = true;
    callButton.disabled = true;
    hangupButton.disabled = false;
    connectButton.disabled = true;
    sendTestButton.disabled = false;
}

function valid(id)
{
    var textVal=document.getElementById(id).value;
    if (!textVal.match(/\S/)) 
    {
        alert("Field is blank");
        return false;
    } 
    else 
    {
        return true;
    }
 }