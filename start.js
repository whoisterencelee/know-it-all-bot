/*jslint node: true */
'use strict';
const constants = require('byteballcore/constants.js');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const headlessWallet = require('headless-byteball');

const storage = require( 'node-persist' )

var questions = storage.create( { dir : './questions' } )
var userstate = storage.create( { dir : './users' } )

var init_reach = 1

async function start(){

await questions.init()
var qid = await questions.getItem( "_qid" )
if( qid === undefined ) qid = 0

await userstate.init()
var users = await userstate.keys()
console.log( "Number of users " + users.length )
//TODO adjust init_reach based on number of users HERE


function help(){
	return "Pose a question to real people."
	+ "\nGet paid to answer questions by inserting your address using (...)"
}

async function register( from_address ){
	var us = await userstate.getItem( from_address )
	console.log( "terence here " + ( typeof us ) + ( us == undefined ) )
	if( us == undefined ){
		us = { asked : 0 , answering : [] }
		userstate.setItem( from_address , us )
		users.push( from_address )
	}
	return us
}


/**
 * headless wallet is ready
 */
eventBus.once('headless_wallet_ready', () => {
	headlessWallet.setupChatEventHandlers();
	
	/**
	 * user pairs his device with the bot
	 */
	eventBus.on('paired', (from_address, pairing_secret) => {
		// send a greeting message
		const device = require('byteballcore/device.js');
		device.sendMessageToDevice(from_address, 'text', "Time to incentivize Q&A! Type 'help' anytime.")
		device.sendMessageToDevice(from_address, 'text', help() )
		register( from_address )
	});

	/**
	 * user sends message to the bot
	 */
	eventBus.on('text', async (from_address, text) => {
		// analyze the text and respond
		text = text.trim();
		var command = text.toLowerCase()

		var us = await register( from_address )

		const device = require('byteballcore/device.js');

		console.log( "received command " + command )

		if( command == "help" ) device.sendMessageToDevice( from_address , 'text' , help() )
		else if( command == "boost" ){

			var q = await questions.getItem( from_address )
			if( !q ) device.sendMessageToDevice( from_address , 'text' , "Please submit a question first before using boost"  )

			// bot sends text to more random sets of saved addresses based on boost 

		} else if( /^@/.test( text ) ){  // Answers

			console.log("Answer received" )

			var ans = text.match( /^@(\d*)\s*(.+)/ )
			if( !ans || ans.length < 3 ){ device.sendMessageToDevice( from_address , 'text' , "Answer must be formatted as '@<question number> answer text'"  ); return }

			cqid = ans[ 1 ].length > 0 ? ans[ 1 ] : "TODO implement recent question lookup"

			var q = await questions.getItem( cqid )

			if( q == undefined ) device.sendMessageToDevice( from_address , 'text ' , "Cannot answer question @" + cqid )
			else{

				console.log( "answering question @" + cqid )
				//q.answers[ from_address ] 

			}

		} else {  // Question

			if( us.asked++ ) device.sendMessageToDevice( from_address , 'text' , "Before asking another question, lets wait for the answers for your question :\n" ) // TODO display time waiting
			else { 

				var cqid = ++qid
				questions.setItem( "_qid" , qid ) // TODO maybe write every 1000

				var q = {
					text : text ,
					asking : {} ,
					answers : [] ,
					active: true ,
					boost : 0 ,
					time : ( new Date() ).getTime()
					}

				q.asking[ from_address ] = []

				// bot sends text to random sets of addresses including the questioner
				// so that the questioner will also get all the answers and also get to vote
				while( Object.keys( q.asking ).length < ( init_reach * users.length ) ){

					q.asking[ users[ Math.floor( Math.random() * users.length ) ] ] = []

				}

				questions.setItem( cqid.toString() , q )

				Object.keys( q.asking ).forEach( to_address => {

					us.answering.push( cqid.toString() )
					userstate.setItem( to_address , us )

					console.log( "sending question to " + to_address )
					device.sendMessageToDevice( to_address , 'text' , "New Question:\n" + text 
						+ "\n [submit an answer](suggest-command:@" + cqid + " )" )
						
				})


			}
		}

	});

});


/**
 * user pays to the bot
 */
eventBus.on('new_my_transactions', (arrUnits) => {
	// handle new unconfirmed payments
	// and notify user
	
//	const device = require('byteballcore/device.js');
//	device.sendMessageToDevice(device_address_determined_by_analyzing_the_payment, 'text', "Received your payment");
});

/**
 * payment is confirmed
 */
eventBus.on('my_transactions_became_stable', (arrUnits) => {
	// handle payments becoming confirmed
	// and notify user
	
//	const device = require('byteballcore/device.js');
//	device.sendMessageToDevice(device_address_determined_by_analyzing_the_payment, 'text', "Your payment is confirmed");
});



process.on('unhandledRejection', up => { throw up; });

} // function start
start()
