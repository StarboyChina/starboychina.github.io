$(document).ready(function(){

if(window.location.href=="{{ site.BASE_PATH }}/")
{

$("#sidebar").css({width:'100%'});


 $("#btnblog").click(function(){


    $("#sidebar").animate({width:'33.3333%'},'slow');



  });

}

  });
