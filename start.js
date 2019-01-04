/*jslint node: true */
'use strict';
const constants = require('byteballcore/constants.js');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const headlessWallet = require('headless-byteball');

const storage = require( 'node-persist' )

var questions = storage.create( { dir : './questions' } ) , users = []
async function start(){
	await questions.init()
	users = await questions.keys()
	console.log( "Number of registered users " + users.length )
}
start()

function help(){
	return "Pose a question to real people."
	+ "\nGet paid to answer questions by inserting your address using (...)"
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

		questions.getItem( from_address ).then( existing => { if( existing === undefined ){ 
			questions.setItem( from_address , null )
			users.push( from_address )
		} } )
	});

	/**
	 * user sends message to the bot
	 */
	eventBus.on('text', async (from_address, text) => {
		// analyze the text and respond
		text = text.trim();
		var command = text.toLowerCase()

		const device = require('byteballcore/device.js');

		if( command == "help" ) device.sendMessageToDevice( from_address , 'text' , help() )
		else if( command == "boost" ){

			var q = await questions.getItem( from_address )
			if( !q ) device.sendMessageToDevice( from_address , 'text' , "Please submit a question first before using boost"  )

			// bot sends text to more random sets of saved addresses based on boost 

		} else if( /^@/.test( text ) ){  // Answers

			console.log("Answer received" )

		} else {  // Question

			var q = await questions.getItem( from_address )
			if( q ) device.sendMessageToDevice( from_address , 'text' , "Before asking another question, lets wait for the answers for your question :\n" + q.text )
			else { 
				q = {
					text : text ,
					sent : [ ] ,
					answers : [ ] ,
					boost : 0 ,
					time : new Date()
					}

				// bot sends text to random sets of saved addresses
				var to_address = users[ Math.floor( Math.random() * users.length ) ]	
				q.sent.push( to_address )

				await questions.setItem( from_address , q )

			//	if( to_address == from_address ) 
				device.sendMessageToDevice( to_address , 'text' , "Question:\n" + text 
					+ "\nSubmit an answer by starting with a '@'" )
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

