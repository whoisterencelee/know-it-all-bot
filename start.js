/*jslint node: true */
'use strict';
const constants = require('byteballcore/constants.js');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const headlessWallet = require('headless-byteball');
const device = require('byteballcore/device.js');
const composer = require('byteballcore/composer.js');
const network = require('byteballcore/network.js');

const storage = require( 'node-persist' )

var questions = storage.create( { dir : './questions' } )
var userstate = storage.create( { dir : './users' } )

// Experiment and Adjust
var init_reach = 1
var max_reach = 50
var ttl = 10 // question time to live in hours
var power = 2
var txfee = 512 // minimum transaction fee affects minimum bounty
var payout = 512 // minimum payout per voter

async function start(){

await questions.init()
var qid = await questions.getItem( "_qid" )
if( qid === undefined ) qid = 0

await userstate.init()
var users = await userstate.keys()
console.log( "Number of users " + users.length )
if( users.length > 50 ) init_reach = init_reach * max_reach / users.length //TODO adjust init_reach based on number of users

function help(){
	return "Pose a Question to real people."
	+ "\nGet paid to answer and vote on questions by inserting your address using (...)"
	+ "\nQuestion is sent randomly to " + ( init_reach * users.length ).toFixed() + " people."
	+ "\nAnyone can add bounty to a question."
	+ "\nBounty is split evenly to registered voters of the best answer,"
	+ "\nwhich is an answer with 1 / " + power + " of voters"
	+ "\nor the highest voted answer after " + ttl + " hours."
	+ "\nVoters can change their vote in that time."
	+ "\nLet start by asking a question."
}

async function register( from_address ){
	var us = await userstate.getItem( from_address )
	if( us == undefined ){
		us = { asked : null , answering : [] }
		userstate.setItem( from_address , us )
		users.push( from_address )
	}
	return us
}

function onError( err ){ throw err }

// from headless_byteball/play/create_payment.js
var composer_callbacks = composer.getSavingCallbacks({
	ifNotEnoughFunds: onError,
	ifError: onError,
	/*      preCommitCb: function (conn, objJoint, handle){ //In this optional callback you can add SQL queries to be executed atomically with the payment
						conn.query("UPDATE my_table SET status='paid' WHERE transaction_id=?",[transaction_id]);                      
						handle();                                                                                                     
					},*/                                                                                                                  
	ifOk: function(objJoint){
		network.broadcastJoint(objJoint);
	}
});

async function payvoters( q , win ){

	var winners = []
	Object.entries( q.voters ).forEach( element => { 
		var user = element[ 0 ] , vote = element[ 1 ]
		if( vote == win ) winners.push( user )
	})

	var paying = []
	var wl = winners.length
	for( var i = 0 ; i < wl ; i++ ){
		var user = await userstate.getItem( winners[ i ] )
		if( user && user.payaddress ) paying.push( { address : user.payaddress } )
	}

	var fairpayout = Math.floor( ( q.bounty - 2 * txfee ) / paying.length ) // also the txfee for the change?
	console.log( "fairpayout " + fairpayout )

	paying.forEach( p => p.amount = fairpayout )

	paying.unshift( { address : q.address , amount : 0 } ) // the change

	console.log( "paying " + JSON.stringify( paying ) )
	composer.composePaymentJoint( [ q.address ], paying , headlessWallet.signer , composer_callbacks )

}

function countvote( q , n , v ){
	
	if( typeof n == "number" && typeof v == "number" &&  v > ( Object.keys( q.voters ).length / power ) ){ // TODO fairer voting system

		q.active = false
		
		broadcast( q , "Question Answered: " + q.text + "Best Answer: " + q.answers[ n ].text )

		payvoters( q , n )

	} else if ( q.time < ( ( new Date() ).getTime() - ( ttl * 1000 * 60 * 60 ) ) ){ // time's up

		q.active = false

		var best = { votes : 0 } , bestn = -1
		q.answers.forEach( ( ans , n ) => { if( ans.votes > best.votes ){ best = ans ; bestn = n } }) // if votes are the same, earlier answer wins

		if( bestn < 0 ) broadcast( q , "Question Time's Up, but received no answer : " + q.text + "\nMaybe submit the question again" )
		else{
			broadcast( q , "Question Time's Up: " + q.text + "Best Answer: " + best.text )

			payvoters( q , bestn )
		}
	}
}

function minpayout( q ){ return Object.keys( q.voters ).length * payout + txfee * 2 }

function send( address , msg ){ device.sendMessageToDevice( address , 'text' , msg ) }
function broadcast( q , msg ){ Object.keys( q.voters ).forEach( to_address => { device.sendMessageToDevice( to_address , 'text' , msg ) }) }

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
		else if( validationUtils.isValidAddress( text ) ){

			us.payaddress = text
			userstate.setItem( from_address , us )
			device.sendMessageToDevice( from_address , 'text' , "Saved address for payment" )

		} else if( /^bounty/.test( command ) ){

			var arg = command.match( /^bounty\s*@(\d*)\s(\d+)/ )
			if( !arg || arg.length < 3 ){ send( from_address , "Bounty format 'bounty @<question number> <amount>'" ); return } 

			var cqid = arg[ 1 ].length > 0 ? arg[ 1 ] : "TODO implement recent question lookup"

			var q = await questions.getItem( cqid )

			if( !q ){ send( from_address , 'text' , "Please submit a question first before using bounty"  ); return }
			if( !q.active ){ send( from_address , "This question is no longer active" ); return }
			if( ( q.bounty + arg[ 2 ] ) < minpayout( q ) ){ send( from_address , "Bounty amount too small, increase above " + minpayout( q ) ); return }

			if( !q.address ){
				headlessWallet.issueNextMainAddress( address => {
					q.address = address 
					questions.setItem( cqid , q )
					send( from_address , "[Pay Bounty @" + cqid + "](byteball:" + q.address + "?amount=" + arg[ 2 ] + ")" )
				})
			} else send( from_address , "[Pay Bounty @" + cqid + "](byteball:" + q.address + "?amount=" + arg[ 2 ] + ")" )

			pending.push( { cqid : cqid , amt : arg[ 2 ] , q : q } )

		} else if( /^promote/.test( command ) ){ // TODO pay to increase number of voters or to other places
			
			// bot sends question to more random sets of saved addresses based on boost 
			send( from_address , "promote command not yet implemented" )

		} else if( /^@/.test( text ) ){  // Answers and Votes

			var ans = text.match( /^@(\d*)\s*(.+)/ )
			if( !ans || ans.length < 3 ){ device.sendMessageToDevice( from_address , 'text' , "Answer format '@<question number> answer_text' or Vote format '@<question number>#<answer index>'"  ); return }

			var cqid = ans[ 1 ].length > 0 ? ans[ 1 ] : "TODO implement recent question lookup"

			var q = await questions.getItem( cqid )

			if( !q.active ){ send( from_address , "This question is no longer active" ); return }

			if( q == undefined ) device.sendMessageToDevice( from_address , 'text ' , "No question @" + cqid )
			else if( /^#\d+/.test( ans[ 2 ] ) ){ // vote

				// check if valid voter
				var validvote = q.voters[ from_address ]
				if( validvote == undefined ) send( from_address , "You don't have voting right to @" + cqid )
				else {

					var which = parseInt( ans[ 2 ].match( /^#(\d+)/ )[ 1 ] )
					if( which > -1 && which < q.answers.length ){

						if( validvote != -1 && q.answers[ validvote ].votes > 0 ) q.answers[ validvote ].votes-- // allow vote change
						var count = ++q.answers[ which ].votes
						q.voters[ from_address ] = which
						send( from_address , "Vote accepted for answer : " + q.answers[ which ].text )

						countvote( q , which , count )

						questions.setItem( cqid , q )
					}
				}

			} else { // submit new answer

				q.answers.push( { text : ans[ 2 ] , votes : 0 } )
				questions.setItem( cqid , q )

				var choices = ""
				q.answers.forEach( ( ans , n ) => { choices += "\nAnswer: " + ans.text + "[ < vote for this](command:@" + cqid + "#" + n + ")" })

				// TODO create contract for more decentralization
				
				var bounty = minpayout( q )
				if( q.bounty > bounty ) bounty = " [add more incentive](suggest-command:bounty @" + cqid + " )"
				else bounty = " [incentivize this question](command:bounty @" + cqid + " " + bounty + " )"

				broadcast( q , "new answer to question :\n" + q.text
					+ choices
					+ "\n Bounty : " + q.bounty + bounty
					+ "\n [submit a different answer](suggest-command:@" + cqid + " )" )

			}

		} else {  // Question

			if( us.asked ){
				var q = await questions.getItem( us.asked )
				if( q.active ){ 
					send( from_address , "Before asking another question, lets wait for the answers for your last question.\n" ) // TODO display remaining time
					return
				}
			}

			var cqid = ( ++qid ).toString()
			questions.setItem( "_qid" , qid ) // TODO maybe write every 1000

			var q = {
				text : text ,
				voters : {} , // TODO reset when done to remove all user data
				answers : [] ,
				active: true ,
				bounty : 0 ,
				address : null ,
				promote : 0 ,
				time : ( new Date() ).getTime()
				}

			// bot sends text to random sets of addresses including the questioner
			// so that the questioner will also get all the answers and also get to vote

			q.voters[ from_address ] = -1

			while( Object.keys( q.voters ).length < ( init_reach * users.length ) ){

				q.voters[ users[ Math.floor( Math.random() * users.length ) ] ] = -1

			}

			questions.setItem( cqid , q )
			us.asked = cqid
			userstate.setItem( from_address , us )

			// TODO start setInterval

			broadcast( q , "New Question:\n" + text 
				+ "\n [incentivize this question](command:bounty @" + cqid + " " + minpayout( q ) + " )"
				+ "\n [submit an answer](suggest-command:@" + cqid + " )" )
					
		}

	});

});


/**
 * user pays to the bot
 */
var pending = [] // TODO how to clear overtime pending? maybe when question goes inactive

eventBus.on('new_my_transactions', (arrUnits) => {
	// handle new unconfirmed payments
	// and notify user
	
	db.query("SELECT address, amount, asset FROM outputs WHERE unit IN (?)", [arrUnits], rows => {
		rows.forEach( row => {

			if( row.asset === null ){

				var remove = pending.findIndex( p => {
						var cqid = p.cqid , amt = p.amt , q = p.q
						
						if( q.address == row.address && amt == row.amount ){

							q.bounty += row.amount
							questions.setItem( cqid , q )

							var choices = ""
							q.answers.forEach( ( ans , n ) => { choices += "\nAnswer: " 
									+ ans.text + "[ < vote for this](command:@" + cqid + "#" + n + ")" })

							broadcast( q , "New Bounty :\n" + q.text
								+ choices
								+ "\nBounty : " + q.bounty + " [add more incentive](suggest-command:bounty @" + cqid + " )"
								+ "\n [submit a different answer](suggest-command:@" + cqid + " )" )

							return true
						}
						return false
					})

				if( remove > -1 ) pending.splice( remove , 1 )

			}

		})
	})
})

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
