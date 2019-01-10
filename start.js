/*jslint node: true */
'use strict';
const constants = require('byteballcore/constants.js');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const headlessWallet = require('headless-byteball');
const device = require('byteballcore/device.js');

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

function broadcast( q , msg ){ Object.keys( q.broadcast ).forEach( to_address => { device.sendMessageToDevice( to_address , 'text' , msg ) }) }

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

		if( command == "help" ) device.sendMessageToDevice( from_address , 'text' , help() )
		else if( command == "boost" ){

			var q = await questions.getItem( from_address )
			if( !q ) device.sendMessageToDevice( from_address , 'text' , "Please submit a question first before using boost"  )

			// bot sends text to more random sets of saved addresses based on boost 

		} else if( validationUtils.isValidAddress( text ) ){

			us.payaddress = text
			userstate.setItem( from_address , us )
			device.sendMessageToDevice( from_address , 'text' , "Saved address for payment" )

		} else if( /^@/.test( text ) ){  // Answers

			var ans = text.match( /^@(\d*)\s*(.+)/ )
			if( !ans || ans.length < 3 ){ device.sendMessageToDevice( from_address , 'text' , "Answer format '@<question number> answer_text'"  ); return }

			// TODO handle votes
			
			cqid = ans[ 1 ].length > 0 ? ans[ 1 ] : "TODO implement recent question lookup"

			var q = await questions.getItem( cqid )

			if( q == undefined ) device.sendMessageToDevice( from_address , 'text ' , "No question @" + cqid )
			else{

				q.answers.push( { text : ans[ 2 ] , by : from_address } )
				questions.setItem( cqid , q )

				var choices = ""
				q.answers.forEach( ( ans , n ) => { choices += "\nAnswer: " + ans.text + "[< vote for this](command:@" + cqid + "#" + n + ")" })

				// TODO create contract
				
				broadcast( q , "New Answer for Question :\n" + q.text
					+ choices
					+ "\n [submit a different answer](suggest-command:@" + cqid + " )" )

			}

		} else {  // Question

			if( us.asked ) device.sendMessageToDevice( from_address , 'text' , "Before asking another question, lets wait for the answers for your question :\n" ) // TODO display time waiting
			else { 

				var cqid = ( ++qid ).toString()
				questions.setItem( "_qid" , qid ) // TODO maybe write every 1000

				var q = {
					text : text ,
					broadcast : {} ,
					answers : [] ,
					active: true ,
					boost : 0 ,
					time : ( new Date() ).getTime()
					}


				// bot sends text to random sets of addresses including the questioner
				// so that the questioner will also get all the answers and also get to vote

				q.broadcast[ from_address ] = []

				while( Object.keys( q.broadcast ).length < ( init_reach * users.length ) ){

					q.broadcast[ users[ Math.floor( Math.random() * users.length ) ] ] = []

				}

				questions.setItem( cqid , q )
				us.asked = cqid
				userstate.setItem( from_address , us )

				broadcast( q , "New Question:\n" + text + "\n [submit an answer](suggest-command:@" + cqid + " )" )
						
			}
		}

		return device.sendMessageToDevice( from_address , 'text' , help() )

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
